
 (function(){
   const root = document.getElementById('revealAnim');
   if(!root) return;

   const CONFIG = {
    scrollStartPct: 1.5,
    scrollEndPct:   0.25,
    easePow:        10,
    endScale:       85,
    ringEnd:        0,
    parallaxPX:     0,
    parallaxZoom:   0.045
   };

   const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
   const svg = root.querySelector('svg');
   const starProbe = svg.querySelector('#revealStarProbe');

   function setStarOrigin(){
    if(!starProbe) return;
    try{
      const bb = starProbe.getBBox();
      const cx = bb.x + bb.width/2;
      const cy = bb.y + bb.height/2;
      svg.style.setProperty('--cx', '94.5px');
      svg.style.setProperty('--cy', '48px');
    }catch(e){
      svg.style.setProperty('--cx', '50%');
      svg.style.setProperty('--cy', '50%');
    }
   }
   setStarOrigin();

   const clamp = (n,min,max)=> Math.max(min, Math.min(max,n));
   const ease  = t => Math.pow(t, CONFIG.easePow);

   function computeProgress(){
    const rect = root.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;

    const startY = vh * CONFIG.scrollStartPct;
    const endY   = vh * CONFIG.scrollEndPct;
    const center = rect.top + rect.height/2;

    const raw = 1 - (center - endY) / (startY - endY);
    const p   = clamp(raw, 0, 1);
    const e   = ease(p);

    svg.style.setProperty('--p', e.toFixed(4));
    svg.style.setProperty('--end-scale', CONFIG.endScale.toString());
    svg.style.setProperty('--ring-end',  CONFIG.ringEnd.toString());

    const y = (1 - e) * CONFIG.parallaxPX - e * CONFIG.parallaxPX;
    const s = 1 + CONFIG.parallaxZoom - (e * CONFIG.parallaxZoom);

    svg.style.setProperty('--py', y.toFixed(2) + 'px');
    svg.style.setProperty('--img-scale', s.toFixed(3));
   }

   let running = false;
   function frame(){ if(!running) return; computeProgress(); requestAnimationFrame(frame); }

   const io = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
     if(entry.isIntersecting){ running = true; frame(); }
     else { running = false; }
    });
   }, {threshold:[0, 0.1, 0.25, 0.4, 0.6, 0.8, 1]});

   if(prefersReduced){
    svg.style.setProperty('--p', 1);
    svg.style.setProperty('--py', '0px');
    svg.style.setProperty('--img-scale', '1');
    return;
   }

   io.observe(root);
   ['resize','orientationchange'].forEach(ev=>{
     window.addEventListener(ev, ()=>{ setStarOrigin(); if(!running) computeProgress(); }, {passive:true});
   });

   computeProgress();
 })();



  // AOS removed. Reduced-motion behavior handled globally.
  function timeSince(dateString){
   const now = new Date(); const t = new Date(dateString);
   const days = Math.floor((now - t) / (1000*60*60*24));
   const months = Math.floor(days / 30); const years = Math.floor(months / 12);
   if(Number.isNaN(days)) return "";
   if(years > 0) return years + 'y ago';
   if(months > 0) return months + 'mo ago';
   return Math.max(days, 0) + 'd ago';
  }

  const articles = [
   { date: '2023-06-30', id: 'article-age-1' },
   { date: '2023-05-31', id: 'article-age-2' },
   { date: '2019-06-10', id: 'article-age-3' },
   { date: '2019-06-19', id: 'article-age-4' },
   { date: '2019-05-30', id: 'article-age-5' }
  ];
  articles.forEach(a => { const el = document.getElementById(a.id); if(el) el.textContent = timeSince(a.date); });








// Carousels now handled by global component (carousel.js/home.js). Legacy per-carousel builders removed.