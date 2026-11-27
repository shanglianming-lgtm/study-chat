"""Run with Blender 4.3: blender -b White_Dress_Avatar.blend --python export-player.py -- output.glb."""
import sys
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


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


def bell(value, center, width):
    return math.exp(-((value - center) / width) ** 2)


def refine_silhouette(obj):
    # The same rest-space warp fits skin, cloth, ribbon and straps together.
    # Keep head, hands, feet, limb lengths and the skeleton unchanged.
    def shape(co):
        x, y, z = co
        torso = 1 - smoothstep((abs(x) - 0.13) / 0.07)
        waist = bell(z, 1.055, 0.085) * torso
        hip = bell(z, 0.90, 0.10) * torso
        co.x *= 1 - 0.245 * waist + 0.115 * hip
        co.y = (-0.025 + (y + 0.025) * (1 - 0.145 * waist + 0.075 * hip)
                + .009 * waist - .004 * bell(z, 1.18, .07) * torso)
        if z < 0.84 and obj.name.startswith('Skin '):
            side = 1 if x > 0 else -1
            # A continuous thigh/knee/calf profile, not a cylindrical leg.
            center = side * (0.0465 + 0.010 * min(1, max(0, (z - .103) / .415))
                             + 0.020 * min(1, max(0, (z - .518) / .352)))
            fullness = (1 + .08 * bell(z, .72, .12) - .035 * bell(z, .52, .070)
                        + .040 * bell(z, .36, .12))
            co.x = center + (co.x - center) * fullness
            center_y = .025 - .021 * min(1, max(0, (z - .103) / .415))
            co.y = center_y + (co.y - center_y) * fullness
            # Anterior patella and posterior calf read as anatomy, not tubes.
            front = smoothstep((center_y - y) / .025)
            co.y -= .003 * bell(z, .525, .050) * front
            co.y += .002 * bell(z, .36, .12) * (1 - front)
    if obj.data.shape_keys:
        for key in obj.data.shape_keys.key_blocks:
            for p in key.data:
                shape(p.co)
    else:
        for v in obj.data.vertices:
            shape(v.co)


def refine_joint_surface(obj, rig):
    # Skin and clothing share this deformation so straps stay above the deltoid.
    # Shape the entire upper-arm/forearm run continuously: rounded deltoid,
    # elbow taper, forearm belly and a slimmer wrist, rather than uniform tubes.
    for vertex in obj.data.vertices:
        co = vertex.co
        side = 'L' if co.x > 0 else 'R'
        upper = rig.data.bones['J_Bip_' + side + '_UpperArm']
        lower = rig.data.bones['J_Bip_' + side + '_LowerArm']
        distance = abs(co.x) - abs(upper.head_local.x)
        if not -.015 < distance < .48:
            continue
        bone = upper if distance < .219 else lower
        axis = (bone.tail_local - bone.head_local).normalized()
        along = (co - bone.head_local).dot(axis)
        center = bone.head_local + axis * along
        radial = co - center
        if radial.length > .095:
            continue
        profile = (.25 * bell(distance, .040, .045)
                   + .10 * bell(distance, .12, .055)
                   - .17 * bell(distance, .219, .040)
                   + .23 * bell(distance, .29, .050)
                   - .21 * bell(distance, .426, .026))
        # Fade to the torso and palm without changing the hand's knuckles.
        # Preserve the medial shoulder where the authored ribbon is attached.
        fade = smoothstep((distance - .025) / .040) * (1 - smoothstep((distance - .435) / .045))
        vertex.co += radial * profile * fade
    # Keep a soft deltoid/elbow/knee cap instead of letting a narrow hinge read
    # as a separate tube. Small radial additions taper continuously to zero.
    for side in ('L', 'R'):
        for name, radius, volume in [('LowerArm', .055, .004),
                                     ('LowerLeg', .060, .001)]:
            bone = rig.data.bones['J_Bip_' + side + '_' + name]
            axis = (bone.tail_local - bone.head_local).normalized()
            for vertex in obj.data.vertices:
                delta = vertex.co - bone.head_local
                influence = smoothstep(1 - delta.length / radius)
                radial = delta - axis * delta.dot(axis)
                if influence and radial.length > .005:
                    vertex.co += radial.normalized() * volume * influence


def refine_joints(obj, rig):
    # Smooth the *weights* locally as well as the surface. More polygons alone
    # cannot fix a hard change of influence across an elbow or shoulder.
    regions = [(rig.data.bones['J_Bip_' + side + '_' + name].head_local, radius)
               for side in ('L', 'R')
               for name, radius in [('LowerArm', .055),
                                    ('Hand', .027), ('LowerLeg', .060)]]
    adjacency = [set() for _ in obj.data.vertices]
    for edge in obj.data.edges:
        a, b = edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)
    original = [{g.group: g.weight for g in v.groups} for v in obj.data.vertices]
    weights = original
    mask = [max(max(0, 1 - (v.co - p).length / radius) ** 2
                for p, radius in regions) for v in obj.data.vertices]
    for _ in range(3):
        updated = []
        for i, neighbours in enumerate(adjacency):
            if not mask[i] or not neighbours:
                updated.append(weights[i])
                continue
            result = {g: w * (1 - .55 * mask[i]) for g, w in weights[i].items()}
            for j in neighbours:
                for g, w in weights[j].items():
                    result[g] = result.get(g, 0) + w * .55 * mask[i] / len(neighbours)
            updated.append(result)
        weights = updated
    for v, values, influence in zip(obj.data.vertices, weights, mask):
        if not influence:
            continue
        for g in original[v.index]:
            obj.vertex_groups[g].remove([v.index])
        strongest = sorted(values.items(), key=lambda item: item[1], reverse=True)[:4]
        total = sum(w for _, w in strongest)
        for g, w in strongest:
            obj.vertex_groups[g].add([v.index], w / total, 'REPLACE')
    smooth = next(m for m in obj.modifiers if m.type == 'SUBSURF')
    smooth.levels = smooth.render_levels = 2


def refine_hair(scene):
    # Each authored lock is lofted from three editable Bezier guides. Move all
    # three together, leaving scalp attachment fixed, instead of distorting UVs.
    for obj in scene.objects:
        if obj.type != 'CURVE' or not obj.name.startswith('Guides'):
            continue
        long = 'Back waves' in obj.name or 'Separated ends' in obj.name
        for index, spline in enumerate(obj.data.splines):
            lock = index // 3
            phase = lock * 2.399 + (0.7 if obj.name.endswith('R') else 0)
            for i, p in enumerate(spline.bezier_points):
                t = i / (len(spline.bezier_points) - 1)
                lower = smoothstep((t - .42) / .58)
                side = 1 if p.co.x > 0 else -1
                offset = Vector((side * (.010 * math.sin(phase + 2.2 * t) +
                                         .012 * math.sin(4.3 * t)) * lower,
                                 .016 * math.sin(phase + 3 * t) * lower,
                                 (.020 + .030 * (.5 + .5 * math.sin(phase))) * lower))
                if not long:
                    offset *= .30
                p.co += offset
                p.handle_left += offset
                p.handle_right += offset
    for obj in scene.objects:
        if obj.type != 'MESH' or not obj.get('flowRetopology'):
            continue
        smooth = obj.modifiers.new('Rounded layered locks and tapered tips', 'SUBSURF')
        smooth.levels = smooth.render_levels = 1
        # Interpolate the loft before skinning, so turning the head cannot
        # introduce a different hair silhouette from the rest-space preview.
        index = next(i for i, m in enumerate(obj.modifiers) if m == smooth)
        armature = next(i for i, m in enumerate(obj.modifiers) if m.type == 'ARMATURE')
        obj.modifiers.move(index, armature)
        for face in obj.data.polygons:
            face.use_smooth = True
    material = next(m for m in bpy.data.materials if 'chestnut strand colour' in m.name)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    texture = next(n for n in nodes if n.type == 'TEX_IMAGE')
    source = texture.image
    width, height = source.size
    pixels = np.empty(len(source.pixels), dtype=np.float32)
    source.pixels.foreach_get(pixels)
    pixels = pixels.reshape((height, width, 4))
    u, v = np.meshgrid(np.arange(width) / width, np.arange(height) / height)
    # Fine longitudinal strands sit underneath the existing broad lock tones.
    # Bake them for glTF, rather than adding an unsupported procedural shader.
    flow = u + .0018 * np.sin(v * 19 + u * 11)
    strand = (.045 * np.sin(flow * math.tau * 173) +
              .025 * np.sin(flow * math.tau * 317 + 1.4))
    pixels[:, :, :3] *= (1.06 + strand[:, :, None])
    pixels[:, :, :3] = np.clip(pixels[:, :, :3], 0, 1)
    atlas = bpy.data.images.new('Chestnut | fine longitudinal strands', width, height, alpha=True)
    atlas.pixels.foreach_set(pixels.ravel())
    atlas.pack()
    texture.image = atlas
    shader = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Roughness'].default_value = .49
    # Tangent-space strand relief is portable to the browser, unlike Blender's
    # procedural hair BSDF. Keep the relief shallow, not metallic/glittering.
    nx = .12 * np.sin(flow * math.tau * 173) + .05 * np.sin(flow * math.tau * 317 + 1.4)
    normal = np.ones_like(pixels)
    normal[:, :, 0] = .5 + nx * .5
    normal[:, :, 1] = .5
    normal[:, :, 2] = .5 + .5 * np.sqrt(1 - nx * nx)
    normal_image = bpy.data.images.new('Chestnut | strand relief', width, height, alpha=False)
    normal_image.colorspace_settings.name = 'Non-Color'
    normal_image.pixels.foreach_set(normal.ravel())
    normal_image.pack()
    normal_texture = nodes.new('ShaderNodeTexImage')
    normal_texture.image = normal_image
    normal_map = nodes.new('ShaderNodeNormalMap')
    normal_map.inputs['Strength'].default_value = .35
    links.new(normal_texture.outputs['Color'], normal_map.inputs['Color'])
    links.new(normal_map.outputs['Normal'], shader.inputs['Normal'])


scene = bpy.context.scene
scene.frame_set(1)
rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
portable_materials()
refine_hair(scene)
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
    if not obj.get('flowRetopology') and not obj.name.startswith('Face '):
        refine_silhouette(obj)
        refine_joint_surface(obj, rig)
    if obj.name.startswith("Skin "):
        refine_joints(obj, rig)
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
    obj.data.update()
    obj.update_tag(refresh={'DATA'})
    deps.update()
    evaluated = obj.evaluated_get(deps).data
    evaluated.calc_loop_triangles()
    count = len(evaluated.loop_triangles)
    # Do not globally decimate the hands along with the body: it erases nail
    # edges and knuckles used by both the worn rig and the extracted page hand.
    budget = (80000 if obj.name.startswith('Skin ') else
              14000 if obj.name.startswith('Face ') else
              10000 if obj.name.startswith('Skirt ') else
              6000 if obj.name.startswith('Camisole ') else 2200)
    if count > budget and not obj.get("flowRetopology"):
        modifier = obj.modifiers.new("Player mesh detail", "DECIMATE")
        modifier.ratio = budget / count

deps.update()
bpy.context.view_layer.objects.active = rig
output = Path(sys.argv[sys.argv.index("--") + 1])
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format="GLB", use_selection=True, use_active_scene=True,
    export_apply=True, export_skins=True, export_current_frame=True, export_rest_position_armature=False,
    export_animations=False, export_morph=False, export_extras=True, export_lights=False, export_cameras=False,
)
