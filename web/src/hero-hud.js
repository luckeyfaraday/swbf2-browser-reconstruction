// Hero HUD overlay: health, block stamina and ability cooldowns. Browser UI; the
// native hero HUD artwork is not recovered. Elements live in index.html (#hero-hud).
const $=id=>globalThis.document?.getElementById(id)??null;

export function createHeroHud() {
  const root=$('hero-hud');if(!root)return null;
  const fill=(id,fraction)=>{const el=$(id);if(el)el.style.width=`${Math.max(0,Math.min(1,fraction))*100}%`;};
  return {
    update(runtime) {
      const player=runtime.player,hero=player?.hero;
      globalThis.document.body.classList.toggle('hero-mode',!!hero);
      if(hero)$('hero-name').textContent=(player.name??'HERO').toUpperCase();
      root.hidden=!hero;if(!hero)return;
      const s=hero.state,p=hero.parameters;
      fill('hero-health-fill',player.health/p.health);$('hero-health-label').textContent=Math.ceil(player.health);
      fill('hero-stamina-fill',s.stamina/p.block.stamina);
      $('hero-stamina').classList.toggle('broken',s.blockBroken>0);
      $('hero-shield').hidden=!(s.rageShield>0);if(s.rageShield>0)fill('hero-shield-fill',s.rageShield/Math.max(1,p.rage.shield));
      for(const [ability,label]of [['choke','choke'],['throw','throw'],['rage','rage']]) {
        const el=$(`hero-ability-${label}`);if(!el)continue;
        const remaining=s.cooldowns[ability],total=p[ability].cooldown;
        el.style.setProperty('--cooldown',`${total>0?remaining/total*100:0}%`);
        el.classList.toggle('ready',remaining<=0&&(ability!=='throw'||s.saberInHand));
        el.classList.toggle('active',ability==='rage'?s.rage>0:ability==='choke'?s.action?.type==='choke':!!s.thrown);
        el.querySelector('.cd').textContent=remaining>0?Math.ceil(remaining):'';
      }
    },
  };
}
