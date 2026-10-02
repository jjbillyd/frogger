"""Called by build_wetland.py in the same Blender namespace."""
paint=material('Vehicle / enamel paint',(.32,.12,.075),.28)
glass=material('Vehicle / blue smoke glass',(.025,.065,.085),.18)
rubber=material('Vehicle / rubber',(.018,.022,.022),.82)
metal=material('Vehicle / brushed aluminium',(.36,.39,.38),.28)
next(n for n in metal.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Metallic'].default_value=.65
lamp=material('Vehicle / headlamp',(.85,.77,.47),.2)
rear=material('Vehicle / taillamp',(.38,.012,.006),.25)
cargo=material('Vehicle / warm ivory cargo',(.57,.58,.48),.73)

def vehicle(kind):
    parts=[]
    def box(name,center,size,mat,bevel=.06):
        bpy.ops.mesh.primitive_cube_add(size=1,location=center)
        o=bpy.context.object;o.name=name;o.scale=size
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        o.data.materials.append(mat)
        mod=o.modifiers.new('Rounded stamped edges','BEVEL');mod.width=bevel;mod.segments=3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in o.data.polygons:p.use_smooth=True
        mod=o.modifiers.new('Weighted panel normals','WEIGHTED_NORMAL');mod.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        parts.append(o);return o
    def wheel(x,y,z,r):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=.23,location=(x,y,z),rotation=(math.pi/2,0,0))
        o=bpy.context.object;o.data.materials.append(rubber);parts.append(o)
        bevel=o.modifiers.new('Tyre shoulder','BEVEL');bevel.width=.055;bevel.segments=2;bpy.ops.object.modifier_apply(modifier=bevel.name)
        for p in o.data.polygons:p.use_smooth=True
        bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=r*.57,depth=.245,location=(x,y,z),rotation=(math.pi/2,0,0))
        o=bpy.context.object;o.data.materials.append(metal);parts.append(o)
    if kind=='car':
        box('Sill', (0,0,.43),(3.65,1.66,.35),paint,.13)
        box('Shoulder', (0,0,.72),(3.75,1.7,.34),paint,.14)
        box('Glazed cabin',(.18,0,1.12),(1.83,1.48,.67),glass,.23)
        box('Roof',(.22,0,1.45),(1.47,1.43,.09),paint,.075)
        for y in [-.748,.748]:
            box('B pillar',(.19,y,1.13),(.075,.035,.60),paint,.016)
            box('Door handle',(.62,y*1.13,.83),(.20,.027,.035),metal,.014)
            box('Wing mirror',(-.63,y*1.15,1.01),(.20,.17,.12),paint,.04)
        for x in [-1.18,1.18]:
            for y in [-.81,.81]:wheel(x,y,.35,.35)
        for x in [-1.85,1.85]:box('Bumper',(x,0,.44),(.1,1.53,.11),metal,.04)
        box('Grille',(-1.91,0,.64),(.025,.78,.13),rubber,.02)
        for y in [-.59,.59]:
            box('Headlamp',(-1.875,y,.76),(.065,.30,.17),lamp,.04)
            box('Taillamp',(1.875,y,.76),(.065,.29,.15),rear,.035)
    else:
        box('Chassis',(0,0,.49),(7.85,1.85,.26),rubber,.04)
        box('Cab',(-2.95,0,1.02),(2.0,2.08,1.38),paint,.16)
        box('Cab glass',(-3.08,0,1.65),(1.62,1.97,.63),glass,.13)
        box('Cab roof',(-2.98,0,2.0),(1.99,2.12,.15),paint,.10)
        box('Cargo',(1.07,0,1.59),(5.68,2.22,2.02),cargo,.10)
        for y in [-1.13,1.13]:
            box('Cargo lower rail',(1.07,y,.72),(5.68,.055,.10),metal,.025)
            for j in range(10):box('Cargo seam',(-1.6+j*.56,y,1.67),(.025,.025,1.74),metal,.005)
        for x in [-3.05,.4,2.65]:
            for y in [-1.02,1.02]:wheel(x,y,.43,.43)
        box('Bumper',(-3.99,0,.58),(.075,2.1,.17),metal,.03)
        box('Grille',(-3.98,0,1.10),(.04,1.15,.43),rubber,.035)
        for y in [-.82,.82]:
            box('Headlamp',(-4.0,y,.85),(.055,.30,.22),lamp,.03)
            box('Taillamp',(3.95,y,.68),(.04,.30,.15),rear,.02)
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:p.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();obj=bpy.context.object;obj.name=kind.title()+' / coachwork'
    # Bake object transform into geometry so the glTF root is centred at road origin.
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'Assets/models'/f'{kind}.glb'),use_selection=True,use_active_scene=True,export_animations=False,export_yup=True)
    obj.location=(0,5 if kind=='car' else 8,0)
for kind in ['car','truck']:vehicle(kind)
