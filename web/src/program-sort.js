// Opaque draws grouped by shader program, then material, then front to back.
// three's default order groups by material id only, so the ~90 programs shared by
// ~900 materials interleave and every program switch re-checks all light
// uniforms. Program ids are cached per material and refreshed by generation, so a
// material that is recompiled (reflection mode, diagnostics) is re-keyed soon after.
const KEY=Symbol('bf2ProgramSortKey'),GENERATION=Symbol('bf2ProgramSortGeneration');

export function installProgramSort(renderer,{refreshFrames=300}={}) {
  let generation=0,frames=0;
  const key=material=>{
    if(material[GENERATION]===generation)return material[KEY];
    const id=renderer.properties.get(material).currentProgram?.id;
    if(id===undefined)return 0;
    material[KEY]=id;material[GENERATION]=generation;return id;
  };
  renderer.setOpaqueSort((a,b)=>{
    if(a.groupOrder!==b.groupOrder)return a.groupOrder-b.groupOrder;
    if(a.renderOrder!==b.renderOrder)return a.renderOrder-b.renderOrder;
    if(a.material!==b.material) {
      const programA=key(a.material),programB=key(b.material);
      if(programA!==programB)return programA-programB;
      return a.material.id-b.material.id;
    }
    if(a.z!==b.z)return a.z-b.z;
    return a.id-b.id;
  });
  return {tick(){if(++frames%refreshFrames===0)generation++;},snapshot:()=>({generation,frames})};
}
