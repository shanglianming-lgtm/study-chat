"""Run with Blender 4.3: blender -b White_Dress_Avatar.blend --python export-player.py -- output.glb."""
import sys
from pathlib import Path

import bpy


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


scene = bpy.context.scene
scene.frame_set(1)
rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
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
        weight_skirt(obj)
    if obj.name.startswith("Face ") or any("Chestnut hair" in c.name for c in obj.users_collection):
        obj["firstPersonHidden"] = True
    evaluated = obj.evaluated_get(deps).data
    evaluated.calc_loop_triangles()
    count = len(evaluated.loop_triangles)
    budget = 9500 if obj.name.startswith(("Skin ", "Face ")) else 2200
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

