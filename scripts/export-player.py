"""Run with Blender 4.3: blender -b White_Dress_Avatar.blend --python export-player.py -- output.glb."""
import sys
from pathlib import Path

import bpy
import numpy as np


def smoothstep(value):
    t = max(0.0, min(1.0, value))
    return t * t * (3.0 - 2.0 * t)


def weight_skirt(obj):
    # The source models a standing dress. Let its lower folds follow the thighs
    # as the player steps or sits, retaining the torso weights at the waistband.
    left = obj.vertex_groups.new(name="J_Bip_L_UpperLeg")
    right = obj.vertex_groups.new(name="J_Bip_R_UpperLeg")
    for vertex in obj.data.vertices:
        follow = smoothstep((0.96 - vertex.co.z) / 0.24)
        if not follow:
            continue
        for group_index, weight in [(g.group, g.weight) for g in vertex.groups]:
            obj.vertex_groups[group_index].add([vertex.index], weight * (1 - follow), "REPLACE")
        share = smoothstep((vertex.co.x + 0.10) / 0.20)
        left.add([vertex.index], follow * share, "REPLACE")
        right.add([vertex.index], follow * (1 - share), "REPLACE")


def tag_scalp(obj):
    # The source body includes the scalp. Keep it in the full model as its
    # own material primitive so the wearer's camera can hide it with the face.
    scalp = obj.data.materials[0].copy()
    scalp.name = "Player scalp"
    scalp["firstPersonHidden"] = True
    obj.data.materials.append(scalp)
    for face in obj.data.polygons:
        if face.center.z > 1.365:
            face.material_index = len(obj.data.materials) - 1


def portable_materials():
    # glTF cannot carry Blender's legacy colour mix nodes. Bake their tint into
    # the existing RGBA atlas: keeping alpha is essential for the lash cards.
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if shader is None:
            continue
        if material.name.startswith(('Brows', 'Lash line', 'Lashes')):
            texture = next(n for n in nodes if n.type == 'TEX_IMAGE')
            mix = next(n for n in nodes if n.type == 'MIX_RGB')
            source = texture.image
            pixels = np.empty(len(source.pixels), dtype=np.float32)
            source.pixels.foreach_get(pixels)
            pixels = pixels.reshape((-1, 4))
            # Image.pixels exposes encoded sRGB for these byte-backed atlases,
            # whereas shader socket colours are scene-linear. Multiply in
            # linear light, then encode once for the portable colour texture.
            rgb = pixels[:, :3]
            linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
            linear *= np.array(mix.inputs['Color2'].default_value[:3])
            pixels[:, :3] = np.where(linear <= 0.0031308, linear * 12.92,
                                    1.055 * linear ** (1 / 2.4) - 0.055)
            baked = bpy.data.images.new(material.name + ' | portable tint', *source.size, alpha=True)
            baked.pixels.foreach_set(pixels.ravel())
            baked.pack()
            texture.image = baked
            links.new(texture.outputs['Color'], shader.inputs['Base Color'])
            links.new(texture.outputs['Alpha'], shader.inputs['Alpha'])
        if material.name.startswith('Dress '):
            # Use the authored cotton colour, not a translucent shader mix
            # which silently falls back to glTF's default roughness.
            output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
            links.new(shader.outputs['BSDF'], output.inputs['Surface'])
            for link in list(shader.inputs['Roughness'].links):
                links.remove(link)
            shader.inputs['Roughness'].default_value = 0.83
        if material.name.startswith(('Skin', 'Face')):
            shader.inputs['Roughness'].default_value = 0.64


def soften_hem(obj):
    # Relax only the vertical component of the rolled hem. The original
    # radial pleats, waist, length and rig remain authored, not regenerated.
    adjacency = [set() for _ in obj.data.vertices]
    for edge in obj.data.edges:
        a, b = edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)
    for _ in range(12):
        heights = [v.co.z for v in obj.data.vertices]
        for v, neighbours in zip(obj.data.vertices, adjacency):
            influence = smoothstep((0.75 - v.co.z) / 0.035)
            if influence and neighbours:
                mean = sum(heights[i] for i in neighbours) / len(neighbours)
                v.co.z += (mean - v.co.z) * 0.45 * influence


scene = bpy.context.scene
scene.frame_set(1)
rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
portable_materials()
hair = next(m for m in bpy.data.materials if "chestnut strand colour" in m.name)
# The original groom uses a procedural shader. Its vertex colour is the
# portable fallback. The curve-authored groom already uses a packed UV atlas.
tone = next((n for n in hair.node_tree.nodes if n.type == "VERTEX_COLOR"), None)
if tone is not None:
    shader = next(n for n in hair.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    hair.node_tree.links.new(tone.outputs["Color"], shader.inputs["Base Color"])
    for link in list(shader.inputs["Emission Color"].links):
        hair.node_tree.links.remove(link)
    shader.inputs["Emission Strength"].default_value = 0

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
deps = bpy.context.evaluated_depsgraph_get()
for obj in scene.objects:
    if obj.type != "MESH" or obj.parent != rig or obj.hide_render:
        continue
    obj.select_set(True)
    if obj.name.startswith("Skin "):
        tag_scalp(obj)
    elif obj.name.startswith("Skirt "):
        soften_hem(obj)
        weight_skirt(obj)
    elif obj.name.startswith('Face '):
        # The face is inexpensive but very close in reference/portrait views.
        smooth = obj.modifiers.new('Continuous cheek and eyelid silhouette', 'SUBSURF')
        smooth.levels = smooth.render_levels = 1
    if obj.name.startswith("Face ") or any("Chestnut hair" in c.name for c in obj.users_collection):
        obj["firstPersonHidden"] = True
    evaluated = obj.evaluated_get(deps).data
    evaluated.calc_loop_triangles()
    count = len(evaluated.loop_triangles)
    # Do not globally decimate the hands along with the body: it erases nail
    # edges and knuckles used by both the worn rig and the extracted page hand.
    budget = (40000 if obj.name.startswith('Skin ') else
              14000 if obj.name.startswith('Face ') else
              10000 if obj.name.startswith('Skirt ') else
              6000 if obj.name.startswith('Camisole ') else 2200)
    if count > budget and not obj.get("flowRetopology"):
        modifier = obj.modifiers.new("Player mesh detail", "DECIMATE")
        modifier.ratio = budget / count

bpy.context.view_layer.objects.active = rig
output = Path(sys.argv[sys.argv.index("--") + 1])
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format="GLB", use_selection=True, use_active_scene=True,
    export_apply=True, export_skins=True, export_current_frame=True, export_rest_position_armature=False,
    export_animations=False, export_morph=False, export_extras=True, export_lights=False, export_cameras=False,
)
