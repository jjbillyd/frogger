"""Original wetland assets. Run in Blender's Python console or with --background --python.
Creates its own scene; never deletes or saves over the user's open project.
"""
import bpy, math, random, json, os
from mathutils import Vector, Matrix
from mathutils.noise import noise_vector
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
random.seed(17)
scene = bpy.data.scenes.new('Frogger — Wetland workshop')
bpy.context.window.scene = scene
scene.render.fps = 60
scene.frame_start = 1
scene.frame_end = 61

# Read enum identifiers from this Blender version before choosing them.
def enum(prop, wanted):
    values = [i.identifier for i in prop.enum_items]
    if wanted not in values: raise ValueError((wanted, values))
    return wanted
MODE = bpy.ops.object.mode_set.get_rna_type().properties['mode']
def mode(value): bpy.ops.object.mode_set(mode=enum(MODE,value))
def material(name, color, roughness=.5, vertex=False):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=roughness
    if vertex:
        n=m.node_tree.nodes.new('ShaderNodeVertexColor'); n.layer_name='Pigment'
        m.node_tree.links.new(n.outputs['Color'],p.inputs['Base Color'])
    return m
skin=material('Wetland / mottled skin',(.2,.36,.055),.48,True)
eye=material('Wetland / amber iris',(.55,.32,.045),.22)
black=material('Wetland / obsidian pupil',(.006,.01,.006),.12)
cream=material('Wetland / ivory teeth',(.71,.66,.43),.55)
wood=material('Wetland / weathered wood',(.18,.085,.027),.91,True)

class Sculpt:
    def __init__(self,name,mats): self.name=name; self.v=[]; self.f=[]; self.c=[]; self.w=[]; self.mi=[]; self.mats=mats
    def vert(self,p,c,w): self.v.append(tuple(p));self.c.append((*(c if c is not None else (1,1,1)),1));self.w.append(w);return len(self.v)-1
    def face(self,ids,mi): self.f.append(ids);self.mi.append(mi)
    def ellipsoid(self,center,size,col,bone,mi=0,seg=28,rings=16,pattern=None):
        start=len(self.v)
        for j in range(rings+1):
            phi=math.pi*j/rings
            for i in range(seg):
                a=2*math.pi*i/seg
                p=Vector((center[0]+size[0]*math.sin(phi)*math.cos(a),center[1]+size[1]*math.sin(phi)*math.sin(a),center[2]+size[2]*math.cos(phi)))
                c=pattern(p) if pattern else col
                self.vert(p,c,{bone:1})
        for j in range(rings):
            for i in range(seg):
                a=start+j*seg+i; b=start+j*seg+(i+1)%seg
                self.face((a+seg,b+seg,b,a),mi)
    def tube(self,points,radii,col,bones,mi=0,sides=16,steps=5,pattern=None):
        # Quad rings with interpolated skin weights around each joint.
        pts=[Vector(p) for p in points]; start=len(self.v); rows=[]
        for k in range(len(pts)-1):
            for j in range(steps): rows.append((k,j/steps))
        rows.append((len(pts)-2,1))
        for k,t in rows:
            p=pts[k].lerp(pts[k+1],t)
            tangent=(pts[k+1]-pts[k]).normalized()
            u=tangent.cross(Vector((0,0,1)))
            if u.length<.01:u=tangent.cross(Vector((0,1,0)))
            u.normalize(); v=tangent.cross(u).normalized()
            r=radii[k]*(1-t)+radii[k+1]*t
            weights={bones[k]:1}
            if t<.22 and k>0:
                f=(.22-t)/.44;weights={bones[k]:1-f,bones[k-1]:f}
            elif t>.78 and k<len(bones)-1:
                f=(t-.78)/.44;weights={bones[k]:1-f,bones[k+1]:f}
            for i in range(sides):
                a=i*2*math.pi/sides; q=p+r*(math.cos(a)*u+math.sin(a)*v)
                self.vert(q,pattern(q) if pattern else col,weights)
        for j in range(len(rows)-1):
            for i in range(sides):
                a=start+j*sides+i;b=start+j*sides+(i+1)%sides
                self.face((a,b,b+sides,a+sides),mi)
        self.face(tuple(start+i for i in reversed(range(sides))),mi)
        self.face(tuple(start+(len(rows)-1)*sides+i for i in range(sides)),mi)
    def finish(self,armature=None):
        mesh=bpy.data.meshes.new(self.name);mesh.from_pydata(self.v,[],self.f);mesh.update()
        obj=bpy.data.objects.new(self.name,mesh);scene.collection.objects.link(obj)
        for m in self.mats:mesh.materials.append(m)
        attr=mesh.color_attributes.new(name='Pigment',type='FLOAT_COLOR',domain='POINT')
        for i,c in enumerate(self.c):attr.data[i].color=c
        for p,mi in zip(mesh.polygons,self.mi):p.material_index=mi;p.use_smooth=True
        if armature:
            for name in armature.data.bones.keys():obj.vertex_groups.new(name=name)
            for i,ws in enumerate(self.w):
                for name,w in ws.items():obj.vertex_groups[name].add([i],w,'REPLACE')
            mod=obj.modifiers.new('Skin — normalized joint weights','ARMATURE');mod.object=armature
            obj.parent=armature
        return obj

def rig(name,definitions):
    ar=bpy.data.armatures.new(name);o=bpy.data.objects.new(name,ar);scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active=o;o.select_set(True);mode('EDIT')
    for n,h,t,parent in definitions:
        b=ar.edit_bones.new(n);b.head=h;b.tail=t
        if parent:b.parent=ar.edit_bones[parent]
    mode('OBJECT');o.select_set(False)
    return o

def frog_color(p):
    n=noise_vector(p*24)[0]; blot=noise_vector(p*10)[1]
    belly=max(0,min(1,(.3-p.z)*8))
    stripe=math.exp(-((abs(p.x)-.25)/.024)**2)*max(0,min(1,(p.z-.38)*8))
    c=Vector((.17,.34,.038))*(.78+.36*n)
    if blot>.24:c*=.63
    c=c.lerp(Vector((.47,.56,.16)),stripe*.8)
    c=c.lerp(Vector((.31,.38,.11)),belly*.65)
    return c

# FROG: broad low head, powerful folded hindlegs, long tarsi and splayed toes.
fdefs=[('Root',(0,0,0),(0,0,.2),None),('Spine',(0,-.22,.32),(0,.2,.37),'Root'),('Head',(0,.2,.37),(0,.57,.42),'Spine')]
frog=Sculpt('Frog / skin and eyes',[skin,eye,black])
frog.ellipsoid((0,-.06,.34),(.35,.46,.26),None,'Spine',seg=48,rings=28,pattern=frog_color)
frog.ellipsoid((0,.34,.4),(.34,.31,.205),None,'Head',seg=40,rings=24,pattern=frog_color)
chains={}
for s,side in [(-1,'L'),(1,'R')]:
    hip=(s*.24,-.28,.32);knee=(s*.48,-.02,.22);ankle=(s*.39,-.52,.105);toe=(s*.52,-.22,.065)
    pts=[hip,knee,ankle,toe]; names=[f'Thigh.{side}',f'Shin.{side}',f'Foot.{side}'];chains[side]=pts
    for k,n in enumerate(names):fdefs.append((n,pts[k],pts[k+1],'Spine' if k==0 else names[k-1]))
    frog.tube(pts,[.13,.14,.065,.035],None,names,steps=8,sides=24,pattern=frog_color)
    for j in range(4):
        end=(s*(.40+j*.072),-.03+(j%2)*.025,.045)
        frog.tube([toe,((toe[0]+end[0])/2,-.14,.065),end],[.023,.017,.008],None,[names[-1]]*2,sides=8,steps=3,pattern=frog_color)
    shoulder=(s*.24,.24,.35);elbow=(s*.36,.16,.15);hand=(s*.34,.48,.055)
    fp=[shoulder,elbow,hand];fn=[f'Arm.{side}',f'Forearm.{side}'];chains['front'+side]=fp
    for k,n in enumerate(fn):fdefs.append((n,fp[k],fp[k+1],'Spine' if k==0 else fn[k-1]))
    frog.tube(fp,[.07,.052,.031],None,fn,steps=7,pattern=frog_color)
    for j in range(4):
        frog.tube([hand,(s*(.24+j*.065),.63-abs(j-1.5)*.027,.035)],[.018,.008],None,[fn[-1]],steps=4,sides=8,pattern=frog_color)
    frog.ellipsoid((s*.205,.40,.56),(.119,.133,.11),None,'Head',pattern=frog_color)
    frog.ellipsoid((s*.213,.482,.594),(.094,.069,.075),None,'Head',mi=1,seg=24,rings=14)
    frog.ellipsoid((s*.213,.538,.599),(.059,.022,.022),None,'Head',mi=2,seg=20,rings=12)
    frog.ellipsoid((s*.104,.617,.444),(.017,.009,.012),None,'Head',mi=2,seg=12,rings=8)
# Delicate curved mouth seam.
pts=[(.30*math.cos(math.pi*i/20),.35+.282*math.sin(math.pi*i/20),.335-.023*math.sin(math.pi*i/20)) for i in range(21)]
frog.tube(pts,[.008]*21,(.026,.045,.009),['Head']*20,steps=1,sides=6)
frogRig=rig('FrogRig',fdefs);frogMesh=frog.finish(frogRig)

def pose_chain(arm,names,points):
    for k,n in enumerate(names):
        pb=arm.pose.bones[n];a=Vector(points[k]);b=Vector(points[k+1]);d=b-a
        pb.matrix=Matrix.LocRotScale(a,d.to_track_quat('Y','Z'),Vector((1,d.length/pb.bone.length,1)))
        bpy.context.view_layer.update()

def key_pose(arm,frame):
    for pb in arm.pose.bones:
        pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_quaternion',frame=frame);pb.keyframe_insert('scale',frame=frame)

# Authored in-place: game controls the trajectory, skeleton controls articulation.
for frame,phase in [(1,'rest'),(4,'crouch'),(9,'push'),(15,'flight'),(20,'reach'),(24,'land'),(28,'rest')]:
    for pb in frogRig.pose.bones:pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    for s,side in [(-1,'L'),(1,'R')]:
        p=[Vector(x) for x in chains[side]]
        if phase=='crouch':p[1].x*=1.13;p[1].z-=.045
        if phase in ('push','flight','reach'):
            k={'push':1,'flight':.85,'reach':.45}[phase]
            targets=[p[0],Vector((s*.37,-.60,.20)),Vector((s*.46,-1.02,.13)),Vector((s*.48,-1.29,.075))]
            p=[a.lerp(b,k) for a,b in zip(p,targets)]
        pose_chain(frogRig,[f'Thigh.{side}',f'Shin.{side}',f'Foot.{side}'],p)
        fp=[Vector(x) for x in chains['front'+side]]
        if phase in ('push','flight'):fp[1]=Vector((s*.32,.27,.27));fp[2]=Vector((s*.25,.44,.23))
        if phase=='reach':fp[1]=Vector((s*.30,.46,.22));fp[2]=Vector((s*.35,.73,.025))
        if phase=='land':fp[1].x*=1.16;fp[1].z-=.055
        pose_chain(frogRig,[f'Arm.{side}',f'Forearm.{side}'],fp)
    key_pose(frogRig,frame)
frogRig.animation_data.action.name='Frog_Hop'
for pb in frogRig.pose.bones:pb.matrix_basis.identity()
scene.frame_set(1)

# CROCODILE: continuous ring mesh through torso and tapering tail, weighted tail chain.
def croc_color(p):
    n=noise_vector(p*12)[0];fine=noise_vector(p*33)[1]
    c=Vector((.095,.13,.046))*(.8+.4*n)
    if p.z<.27:c=c.lerp(Vector((.31,.30,.13)),.65)
    if fine>.28:c*=.62
    return c
cdefs=[('Root',(0,0,0),(0,0,.3),None),('Body',(-1.5,0,.36),(1.4,0,.36),'Root'),('Jaw',(-1.5,0,.49),(-2.8,0,.49),'Body')]
for i in range(4):cdefs.append((f'Tail_{i}',(1.25+i*.58,0,.31),(1.83+i*.58,0,.31),'Body' if i==0 else f'Tail_{i-1}'))
croc=Sculpt('Crocodile / hide scutes and teeth',[skin,eye,black,cream])
# Elliptical rings keep the safe deck broad; silhouette has curved shoulders, no box body.
start=len(croc.v);count=65;sides=28
for j in range(count):
    x=-1.55+j*5.15/(count-1)
    if x<1.15:
        w=.67*math.sqrt(max(.18,1-((x+.05)/2.15)**2));h=.28
    else:
        t=min(1,max(0,(x-1.15)/2.45));w=.48*(1-t)**1.25+.012;h=.24*(1-t)+.015
    if x<1.25:ws={'Body':1}
    else:
        t=min(3.0,max(0,(x-1.25)/.58));k=int(t);f=t-k
        ws={f'Tail_{k}':1-f}
        if k<3:ws[f'Tail_{k+1}']=f
    for i in range(sides):
        a=2*math.pi*i/sides;p=Vector((x,w*math.cos(a),.34+h*math.sin(a)))
        croc.vert(p,croc_color(p),ws)
for j in range(count-1):
    for i in range(sides):
        a=start+j*sides+i;b=start+j*sides+(i+1)%sides;croc.face((a,b,b+sides,a+sides),0)
croc.face(tuple(start+i for i in reversed(range(sides))),0)
croc.face(tuple(start+(count-1)*sides+i for i in range(sides)),0)
# Long rounded snout; upper jaw is the warning bone, matching game mechanics.
croc.ellipsoid((-2.03,0,.47),(.87,.44,.155),None,'Jaw',seg=40,rings=18,pattern=croc_color)
croc.ellipsoid((-2.07,0,.30),(.80,.40,.115),None,'Body',seg=32,rings=14,pattern=croc_color)
croc.ellipsoid((-2.13,0,.40),(.70,.33,.02),(.18,.055,.035),'Body',seg=28,rings=10)
for s in [-1,1]:
    croc.ellipsoid((-1.5,s*.37,.60),(.23,.19,.13),None,'Body',pattern=croc_color,seg=20,rings=12)
    croc.ellipsoid((-1.60,s*.465,.64),(.095,.052,.068),None,'Body',mi=1,seg=16,rings=10)
    croc.ellipsoid((-1.61,s*.505,.64),(.018,.017,.049),None,'Body',mi=2,seg=12,rings=8)
    croc.ellipsoid((-2.72,s*.20,.58),(.075,.055,.025),None,'Jaw',mi=2,seg=12,rings=8)
    for j in range(10):
        x=-2.73+j*.112;y=s*(.23+.12*math.sin(j/9*math.pi))
        croc.tube([(x,y,.425),(x+.015,y,.34)],[.028,.003],None,['Jaw'],mi=3,sides=7,steps=1)
    for x in [-.97,.82]:
        n=f'Leg_{x}_{s}';pts=[(x,s*.42,.30),(x+.18,s*.79,.12),(x+.60,s*.90,.10)]
        cdefs.append((n,pts[0],pts[2],'Body'))
        croc.tube(pts,[.14,.10,.055],None,[n,n],steps=5,pattern=croc_color)
        for j in range(3):croc.tube([pts[-1],(x+.84,s*(.82+j*.10),.08)],[.028,.011],None,[n],sides=8,steps=3,pattern=croc_color)
# Raised dorsal osteoderms, becoming twin crests down the tail.
for j in range(23):
    x=-1.16+j*.197;t=max(0,(x-1.15)/2.45);width=.44*(1-t)
    for s in [-1,0,1]:
        if t>.5 and s==0:continue
        z=.59-.21*t-.045*abs(s)
        bone='Body' if x<1.25 else f'Tail_{min(3,int((x-1.25)/.58))}'
        croc.ellipsoid((x,s*width*.64,z),(.13*(1-.6*t),.10*(1-.7*t),.082*(1-.4*t)),(.12,.16,.055),bone,seg=10,rings=6)
crocRig=rig('CrocodileRig',cdefs);crocMesh=croc.finish(crocRig)
for frame in range(1,62,5):
    t=(frame-1)/60*2*math.pi
    for i in range(4):
        pb=crocRig.pose.bones[f'Tail_{i}'];pb.rotation_mode='QUATERNION'
        from mathutils import Quaternion
        # Local X corresponds to lateral yaw for these horizontal bones.
        axis=pb.bone.matrix_local.to_3x3().inverted()@Vector((0,0,1))
        pb.rotation_quaternion=Quaternion(axis,.12*math.sin(t-i*.65))
        pb.keyframe_insert('rotation_quaternion',frame=frame)
crocRig.animation_data.action.name='Crocodile_Swim'
scene.frame_set(1)

# DRIFTWOOD: irregular quad-ring trunk; bark fissures in actual silhouette, end grain.
log=Sculpt('Driftwood / bark and end grain',[wood]);N=36;R=28
for j in range(N+1):
    x=-.5+j/N
    for i in range(R):
        a=i*2*math.pi/R
        groove=.018*math.sin(a*17+x*5)+.01*math.sin(a*29-x*12)
        rad=.425+groove+.018*math.sin(x*14+a*3)
        p=Vector((x,rad*math.cos(a),.20+rad*math.sin(a)))
        n=noise_vector(Vector((x*23,math.cos(a)*7,math.sin(a)*7)))[0]
        c=Vector((.16,.075,.027))*(.75+.45*n+groove*8)
        if p.z>.48:c=c.lerp(Vector((.15,.21,.055)),max(0,n)*.6)
        log.vert(p,c,{'Float':1})
for j in range(N):
    for i in range(R):
        a=j*R+i;b=j*R+(i+1)%R;log.face((a,b,b+R,a+R),0)
for sign in [-1,1]:
    offset=len(log.v)
    for j in range(9):
        r=.425*j/8
        for i in range(R):
            a=i*2*math.pi/R;p=(sign*.501,r*math.cos(a),.20+r*math.sin(a))
            ring=.8+.16*math.sin(r*185+math.sin(a*3)*.6)
            c=Vector((.47,.29,.125))*ring
            if abs(math.sin(a*3+r*2))<.065 and r>.14:c*=.4
            log.vert(p,c,{'Float':1})
    for j in range(8):
        for i in range(R):
            a=offset+j*R+i;b=offset+j*R+(i+1)%R
            ids=(a,b,b+R,a+R);log.face(tuple(reversed(ids)) if sign>0 else ids,0)
logRig=rig('DriftwoodRig',[('Float',(0,0,.2),(.2,0,.2),None)])
logMesh=log.finish(logRig)
# Single rigid influence: logs float but never bend like animals.
for frame,z,angle in [(1,0,-.017),(31,.018,.017),(61,0,-.017)]:
    pb=logRig.pose.bones['Float'];pb.location.z=z;pb.rotation_quaternion=Quaternion((0,1,0),angle)
    key_pose(logRig,frame)
logRig.animation_data.action.name='Driftwood_Float'
scene.frame_set(1)

assets=[('frog',frogRig,frogMesh),('crocodile',crocRig,crocMesh),('log',logRig,logMesh)]
for name,arm,mesh in assets:
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True);mesh.select_set(True);bpy.context.view_layer.objects.active=arm
    # GLB is the operator default (dynamic enum); retain it rather than hardcoding.
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'Assets/models'/f'{name}.glb'),use_selection=True,use_active_scene=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS',export_frame_range=False,export_force_sampling=True,export_anim_single_armature=True,export_def_bones=True,export_yup=True)
    print(name, 'vertices',len(mesh.data.vertices),'bones',len(arm.data.bones))
# Arrange an editable asset workshop, excluding this layout from exported GLBs.
frogRig.location=(-1,-1.5,0);crocRig.location=(0,1.4,0);logRig.location=(1,-1.4,0);logRig.scale.x=2.8
scene.world=bpy.data.worlds.new('Wetland studio world');scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.12,.16,.18,1);bg.inputs['Strength'].default_value=.5
for name,loc,power,size in [('Key',(-3,-4,7),1100,6),('Rim',(2,4,5),900,5)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=loc;ob.rotation_euler=(-ob.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('Workshop camera');cam=bpy.data.objects.new('Workshop camera',camdata);scene.collection.objects.link(cam)
cam.location=(5,-7,7);cam.rotation_euler=(Vector((0,0,.1))-cam.location).to_track_quat('-Z','Y').to_euler();camdata.type='ORTHO';camdata.ortho_scale=8;scene.camera=cam
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
exec(compile((ROOT/'blender/build_vehicles.py').read_text(), 'build_vehicles.py', 'exec'))
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
        area.spaces.active.shading.type='MATERIAL'
bpy.data.libraries.write(str(ROOT/'blender/wetland-assets.blend'),{scene},fake_user=True)
print('Wetland asset workshop saved independently.')
