// three.js flattens uniform arrays of Vector objects into a scratch buffer on every
// upload, which happens on every material switch. Hundreds of recovered materials
// share the light arrays, so they are kept as one flat Float32Array that three
// passes straight to gl.uniform*fv. The vectors remain the editing interface:
// change one, then call write(index) (or pack() after growing).
export function createPackedVectorUniform(Type,itemSize,make=()=>new Type()) {
  const vectors=[],uniform={value:new Float32Array(0)};
  const write=index=>vectors[index].toArray(uniform.value,index*itemSize);
  const pack=()=>{
    if(uniform.value.length!==vectors.length*itemSize)uniform.value=new Float32Array(vectors.length*itemSize);
    for(let index=0;index<vectors.length;index++)write(index);
  };
  return {vectors,uniform,write,pack,
    ensure(count){if(vectors.length>=count)return;while(vectors.length<count)vectors.push(make());pack();}};
}

// Test/diagnostic view of a packed uniform as one array per element.
export const unpackVectors=(array,itemSize)=>Array.from({length:array.length/itemSize},(_,index)=>[...array.subarray(index*itemSize,(index+1)*itemSize)]);
