// Lowers the HDR render scale only while the GPU, not the CPU, limits the frame
// rate, and restores it when there is headroom. A frame is GPU-bound when its
// interval clearly exceeds the main-thread work it contained; at a display's vsync
// cap the interval stays under the budget, so a fast GPU is never downscaled.
export const ADAPTIVE_RESOLUTION_POLICY=Object.freeze({
  budgetMs:1000/55,headroomMs:1000/75,gpuSlackMs:4,windowMs:1000,cooldownMs:2000,minScale:.5,step:.85,
  note:'Browser performance adaptation, not a source setting. Disabled for agent/test runs.',
});

export function createAdaptiveResolution(apply,{policy=ADAPTIVE_RESOLUTION_POLICY,initialScale=1,now=()=>performance.now()}={}) {
  let scale=initialScale,windowStart=null,lastFrame=null,lastChange=-Infinity,frames=0,frameMs=0,workMs=0,pendingWork=0,changes=0,lastWindow=null;
  apply(scale);
  return {
    addWork(milliseconds){pendingWork+=milliseconds;},
    frame(workMilliseconds) {
      const t=now();pendingWork+=workMilliseconds;
      // Pauses, menus and tab switches are discontinuities, not slow frames.
      if(lastFrame!==null&&t-lastFrame>250){lastFrame=t;pendingWork=0;return scale;}
      if(lastFrame!==null){frames++;frameMs+=t-lastFrame;workMs+=pendingWork;}
      pendingWork=0;lastFrame=t;windowStart??=t;
      if(t-windowStart<policy.windowMs||frames===0)return scale;
      const avgFrame=frameMs/frames,avgWork=workMs/frames,gpuBound=avgFrame-avgWork>policy.gpuSlackMs;
      lastWindow={avgFrame,avgWork,gpuBound};
      windowStart=t;frames=0;frameMs=0;workMs=0;
      if(t-lastChange<policy.cooldownMs)return scale;
      let next=scale;
      if(gpuBound&&avgFrame>policy.budgetMs)next=Math.max(policy.minScale,scale*policy.step);
      else if(avgFrame<policy.headroomMs&&scale<1)next=Math.min(1,scale/policy.step);
      if(Math.abs(next-scale)>1e-3){scale=next;lastChange=t;changes++;apply(scale);}
      return scale;
    },
    snapshot:()=>({scale,changes,lastWindow,policy}),
  };
}
