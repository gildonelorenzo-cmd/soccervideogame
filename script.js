// Fluid Soccer — fixed ball + new lively colors
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(600, Math.floor(rect.width * ratio));
    canvas.height = Math.max(300, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  /* DOM References */
  const mainMenu = document.getElementById('mainMenu');
  const pauseMenu = document.getElementById('pauseMenu');
  const ui = document.getElementById('ui');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const changeDifficultyBtn = document.getElementById('changeDifficultyBtn');
  const restartBtnUI = document.getElementById('restartBtn');
  const startMatchBtn = document.getElementById('startMatchBtn');
  const scoreP = document.getElementById('scoreP');
  const scoreAI = document.getElementById('scoreAI');

  const playerColorChoices = document.getElementById('playerColorChoices');
  const aiColorChoices = document.getElementById('aiColorChoices');
  const difficultyChoices = document.getElementById('difficultyChoices');

  /* NEW LIVELY PALETTE */
  const PALETTE = [
    '#FF4E50', // lively red
    '#FC913A', // orange
    '#F9D423', // yellow
    '#EDE574', // lime yellow
    '#4CB944', // bright green
    '#2CBAE8', // sky blue
    '#4A6CFF', // vivid blue
    '#A657F5', // purple
    '#FF6EC7', // hot pink
    '#FF3CAC'  // neon magenta
  ];

  /* Game State */
  let W = canvas.clientWidth;
  let H = canvas.clientHeight;
  const field = { padding: 40, goalWidthRatio: 0.25 };

  function updateWH() { W = canvas.clientWidth; H = canvas.clientHeight; }
  window.addEventListener('resize', updateWH);

  const settings = {
    playerRadius: 16,
    playerMaxSpeed: 240,
    playerAccel: 1600,
    playerFriction: 8,
    ballRadius: 9,
    ballMaxSpeed: 820,
    ballFriction: 0.995,
    kickPower: 420,
    aiSkill: 0.82,
    slowMotionOnKick: 0.95
  };

  let state = {
    players: [],
    ball: null,
    score: { p: 0, ai: 0 },
    lastTime: null,
    paused: false,
    inMenu: true,
    kickoffTimer: 0
  };

  /* Vector Helpers */
  function vec(x=0,y=0){ return {x,y}; }
  function add(a,b){ return {x:a.x+b.x,y:a.y+b.y}; }
  function sub(a,b){ return {x:a.x-b.x,y:a.y-b.y}; }
  function mul(a,s){ return {x:a.x*s,y:a.y*s}; }
  function len(a){ return Math.hypot(a.x,a.y); }
  function normalize(a){ let L=len(a)||1; return {x:a.x/L,y:a.y/L}; }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  /* Menu selections */
  let selectedPlayerColor = PALETTE[0];
  let selectedAIColor = PALETTE[1];
  let selectedDifficulty = 'medium';

  function buildColorGrid(container, selected, onSelect) {
    container.innerHTML = '';
    PALETTE.forEach(c => {
      const d = document.createElement('div');
      d.className = 'colorChoice' + (c === selected ? ' selected' : '');
      d.style.background = c;
      d.addEventListener('click', () => { onSelect(c); updateGrids(); });
      container.appendChild(d);
    });
  }

  function updateGrids() {
    [...playerColorChoices.children].forEach((el,i)=>el.classList.toggle('selected', PALETTE[i]===selectedPlayerColor));
    [...aiColorChoices.children].forEach((el,i)=>el.classList.toggle('selected', PALETTE[i]===selectedAIColor));
    [...difficultyChoices.querySelectorAll('button')]
      .forEach(b => b.style.outline = (b.dataset.diff===selectedDifficulty) ? '3px solid #fff' : 'none');
  }

  buildColorGrid(playerColorChoices, selectedPlayerColor, c => selectedPlayerColor = c);
  buildColorGrid(aiColorChoices, selectedAIColor, c => selectedAIColor = c);

  difficultyChoices.querySelectorAll('button')
    .forEach(b => b.addEventListener('click', () => { selectedDifficulty = b.dataset.diff; updateGrids(); }));

  updateGrids();

  /* Input */
  const keys = {};
  window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
  window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

  let pointer = null;
  canvas.addEventListener('pointerdown', e => {
    pointer = { id:e.pointerId, x:e.offsetX, y:e.offsetY };
    const b = state.ball;
    if (!b) return;
    const d = Math.hypot(b.pos.x - pointer.x, b.pos.y - pointer.y);
    if (d <= b.radius+30) attemptKick(state.players[0], b);
  });
  canvas.addEventListener('pointermove', e => { if(pointer && e.pointerId===pointer.id){ pointer.x=e.offsetX; pointer.y=e.offsetY; }});
  canvas.addEventListener('pointerup', e => { if(pointer && e.pointerId===pointer.id) pointer=null; });

  /* Entities */
  function createPlayer(x,y,type,color){
    return {
      id:type==='player'?'P':'A',
      type,
      pos:vec(x,y),
      vel:vec(0,0),
      radius:settings.playerRadius,
      color,
      team:type==='player'?'left':'right',
      kickCooldown:0,
      facing:vec(1,0)
    };
  }

  function createBall(x,y){ return { pos:vec(x,y), vel:vec(0,0), radius:settings.ballRadius, color:'#e9f7ff' }; }

  function spawnEntities() {
    const leftX = field.padding + settings.playerRadius*2;
    const rightX = W - field.padding - settings.playerRadius*2;
    const midY = H/2;
    state.players = [
      createPlayer(leftX, midY, 'player', selectedPlayerColor),
      createPlayer(rightX, midY, 'ai', selectedAIColor)
    ];
    state.ball = createBall(W/2, H/2);
  }

  /* Kick */
  function attemptKick(player, ball) {
    if (player.kickCooldown > 0) return;
    const dir = sub(ball.pos, player.pos);
    const dist = len(dir);
    if (dist <= player.radius + ball.radius + 6) {
      const n = normalize(dir);
      ball.vel = add(ball.vel, mul(n, settings.kickPower));
      const sp = len(ball.vel);
      if (sp > settings.ballMaxSpeed)
        ball.vel = mul(normalize(ball.vel), settings.ballMaxSpeed);

      player.kickCooldown = 0.18;
      state.kickSlow = 0.08;
    }
  }

  /* Physics Collision */
  function resolveCircleCollision(a,b){
    const delta = sub(b.pos,a.pos);
    const dist = len(delta)||0.0001;
    const overlap = a.radius+b.radius - dist;
    if(overlap>0){
      const massA = a.type==='player'?2:0.6;
      const massB = b.type==='player'?2:0.6;
      const total = massA+massB;
      const n = {x:delta.x/dist, y:delta.y/dist};

      a.pos.x -= n.x*(overlap*(massB/total));
      a.pos.y -= n.y*(overlap*(massB/total));
      b.pos.x += n.x*(overlap*(massA/total));
      b.pos.y += n.y*(overlap*(massA/total));

      const relVel = sub(b.vel,a.vel);
      const velAlongNormal = relVel.x*n.x + relVel.y*n.y;
      if(velAlongNormal>0) return;

      const impulseMag = -(1+0.7)*velAlongNormal/(1/massA+1/massB);
      const impulse = mul(n,impulseMag);

      a.vel.x -= impulse.x/massA; a.vel.y -= impulse.y/massA;
      b.vel.x += impulse.x/massB; b.vel.y += impulse.y/massB;
    }
  }

  /* Drawing */
  function drawPitch(){
    const pad = field.padding;
    const gw = H*field.goalWidthRatio;

    ctx.fillStyle = '#1f7a4c';
    ctx.fillRect(0,0,W,H);

    ctx.strokeStyle = '#dff3e6';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(W/2,pad/2);
    ctx.lineTo(W/2,H-pad/2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W/2,H/2,Math.min(W,H)/6,0,Math.PI*2);
    ctx.stroke();

    ctx.strokeRect(pad/2,pad/2,W-pad,H-pad);

    // goals
    const goalH = gw;
    const goalY = (H-goalH)/2;
    ctx.fillStyle = '#0b2b18';
    ctx.fillRect(0, goalY, pad/2+10, goalH);
    ctx.fillRect(W-(pad/2+10), goalY, pad/2+10, goalH);
  }

  function drawPlayer(p){
    ctx.save();
    ctx.translate(p.pos.x,p.pos.y);

    ctx.beginPath();
    ctx.ellipse(0,p.radius+8,p.radius*1.2,p.radius*0.5,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.22)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0,0,p.radius,0,Math.PI*2);
    ctx.fillStyle=p.color;
    ctx.fill();

    const f=normalize(p.facing);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(f.x*p.radius*1.2,f.y*p.radius*1.2);
    ctx.strokeStyle='#0008';
    ctx.lineWidth=2;
    ctx.stroke();

    ctx.restore();
  }

  /* FIXED BALL DRAW */
  function drawBall(b){
    ctx.save();
    ctx.translate(b.pos.x,b.pos.y);

    // shadow
    ctx.beginPath();
    ctx.ellipse(4,b.radius+6,b.radius*1.2,b.radius*0.5,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.26)';
    ctx.fill();

    // main circle (FIXED)
    ctx.beginPath();
    ctx.arc(0,0,b.radius,0,Math.PI*2);
    ctx.fillStyle=b.color;
    ctx.fill();

    // highlight (FIXED)
    ctx.beginPath();
    ctx.arc(-b.radius*0.4,-b.radius*0.4,b.radius*0.5,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.12)';
    ctx.fill();

    ctx.restore();
  }

  /* AI */
  function runAI(ai,dt){
    const b = state.ball;

    const toBall = sub(b.pos,ai.pos);
    const dist = len(toBall);

    const approach = normalize(toBall);
    const predict = add(b.pos, mul(b.vel, 0.12*(1-settings.aiSkill)+0.06));

    const target = sub(predict, mul(approach, ai.radius*1.6));
    const targVec = sub(target,ai.pos);
    const targDist = len(targVec);

    let desire = vec(0,0);
    if(targDist>6){
      desire = mul(normalize(targVec), settings.playerMaxSpeed * (0.78 + 0.22*settings.aiSkill));
    } else {
      desire = mul(normalize(sub(b.pos,ai.pos)), settings.playerMaxSpeed*0.4);
    }

    const blend = 0.12 + 0.5*(settings.aiSkill);

    ai.vel.x += (desire.x-ai.vel.x)*clamp(blend,0,1)*dt*60;
    ai.vel.y += (desire.y-ai.vel.y)*clamp(blend,0,1)*dt*60;

    if(len(sub(b.pos, ai.pos))>0.1) ai.facing = normalize(sub(b.pos, ai.pos));

    const closeEnough = dist < ai.radius + b.radius + 14;
    if(closeEnough && ai.kickCooldown<=0){
      const goal = vec(field.padding/2, H/2);
      const dir = normalize(sub(goal,b.pos));
      const jitter = (Math.random()-0.5)*0.25;
      const d2 = normalize(add(dir, mul({x:-dir.y,y:dir.x}, jitter)));

      b.vel = add(b.vel, mul(d2, settings.kickPower * (0.85 + 0.2*(1-settings.aiSkill))));
      ai.kickCooldown = 0.4;
      state.kickSlow = 0.06;
    }

    const sp = len(ai.vel);
    if(sp > settings.playerMaxSpeed)
      ai.vel = mul(normalize(ai.vel), settings.playerMaxSpeed);
  }

  /* Scoring */
  function scoreGoal(who){
    if(state.kickoffTimer>0) return;

    if(who==='p') state.score.p++;
    if(who==='ai') state.score.ai++;

    scoreP.textContent = state.score.p;
    scoreAI.textContent = state.score.ai;

    state.kickoffTimer = 1.2;

    state.players[0].pos = vec(field.padding+settings.playerRadius*2, H/2);
    state.players[0].vel = vec(0,0);

    state.players[1].pos = vec(W-field.padding-settings.playerRadius*2, H/2);
    state.players[1].vel = vec(0,0);
  }

  /* Update Loop */
  function step(t){
    if(!state.lastTime) state.lastTime = t;
    let dt = (t - state.lastTime)/1000;
    state.lastTime = t;
    dt = Math.min(0.04, dt);

    if(!state.paused && !state.inMenu){
      if(state.kickSlow){
        dt *= settings.slowMotionOnKick;
        state.kickSlow -= dt;
        if(state.kickSlow<0) state.kickSlow=0;
      }
      update(dt);
    }

    render();
    requestAnimationFrame(step);
  }

  function update(dt){
    state.players.forEach(p => { p.kickCooldown = Math.max(0,p.kickCooldown-dt); });

    // PLAYER INPUT
    const P = state.players[0];
    let moveDir = vec(0,0);

    if(pointer){
      moveDir.x = pointer.x - P.pos.x;
      moveDir.y = pointer.y - P.pos.y;
    } else {
      if(keys['w']||keys['arrowup']) moveDir.y -=1;
      if(keys['s']||keys['arrowdown']) moveDir.y +=1;
      if(keys['a']||keys['arrowleft']) moveDir.x -=1;
      if(keys['d']||keys['arrowright']) moveDir.x +=1;

      if(keys[' ']) attemptKick(P, state.ball);
    }

    if(len(moveDir)>0){
      const nd = normalize(moveDir);
      P.facing = nd;

      const desired = mul(nd, settings.playerMaxSpeed);
      const deltaV = sub(desired, P.vel);
      const maxChange = settings.playerAccel * dt;
      const changeLen = len(deltaV);

      if(changeLen > maxChange){
        const dv = mul(normalize(deltaV), maxChange);
        P.vel.x += dv.x;
        P.vel.y += dv.y;
      } else {
        P.vel.x = desired.x;
        P.vel.y = desired.y;
      }
    } else {
      P.vel.x -= P.vel.x*clamp(settings.playerFriction*dt,0,1);
      P.vel.y -= P.vel.y*clamp(settings.playerFriction*dt,0,1);
      if(Math.abs(P.vel.x)<4) P.vel.x = 0;
      if(Math.abs(P.vel.y)<4) P.vel.y = 0;
    }

    runAI(state.players[1], dt);

    state.players.forEach(p => {
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;

      const pad = field.padding + p.radius + 2;

      p.pos.x = clamp(p.pos.x, pad, W - pad);
      p.pos.y = clamp(p.pos.y, pad, H - pad);
    });

    // ball physics
    const b = state.ball;

    b.vel.x *= Math.pow(settings.ballFriction, dt*60);
    b.vel.y *= Math.pow(settings.ballFriction, dt*60);

    if(len(b.vel) > settings.ballMaxSpeed)
      b.vel = mul(normalize(b.vel), settings.ballMaxSpeed);

    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;

    // goal detection & walls
    const pad = field.padding;
    const goalH = H * field.goalWidthRatio;
    const goalY = (H - goalH)/2;

    if(b.pos.x - b.radius < pad/2){
      if(b.pos.y > goalY && b.pos.y < goalY+goalH)
        scoreGoal('ai');
      else {
        b.pos.x = pad/2 + b.radius;
        b.vel.x *= -0.78;
      }
    }

    if(b.pos.x + b.radius > W - pad/2){
      if(b.pos.y > goalY && b.pos.y < goalY+goalH)
        scoreGoal('p');
      else {
        b.pos.x = W - pad/2 - b.radius;
        b.vel.x *= -0.78;
      }
    }

    if(b.pos.y - b.radius < pad/2){
      b.pos.y = pad/2 + b.radius;
      b.vel.y *= -0.78;
    }

    if(b.pos.y + b.radius > H - pad/2){
      b.pos.y = H - pad/2 - b.radius;
      b.vel.y *= -0.78;
    }

    resolveCircleCollision(state.players[0], state.players[1]);
    state.players.forEach(p=>{
      resolveCircleCollision(p, b);
      if(p.type==='player'){
        if((keys[' '] || pointer) && len(sub(b.pos,p.pos)) <= p.radius+b.radius+6)
          attemptKick(p,b);
      }
    });

    if(len(b.vel) < 6) b.vel = vec(0,0);

    if(state.kickoffTimer>0){
      state.kickoffTimer -= dt;
      if(state.kickoffTimer<=0){
        state.ball.pos = vec(W/2, H/2);
        state.ball.vel = vec(0,0);
      }
    }
  }

  /* Render */
  function render(){
    W = canvas.clientWidth;
    H = canvas.clientHeight;

    ctx.clearRect(0,0,W,H);
    drawPitch();

    if(!state.ball) return;

    drawBall(state.ball);

    const p0 = state.players[0], p1 = state.players[1];
    const playersSorted = [p0,p1].sort((a,b)=>
        Math.abs(a.pos.y - state.ball.pos.y) -
        Math.abs(b.pos.y - state.ball.pos.y)
    );

    drawPlayer(playersSorted[1]);
    drawPlayer(playersSorted[0]);

    if(state.paused){
      ctx.fillStyle='rgba(0,0,0,0.45)';
      ctx.fillRect(0,0,W,H);
    }
  }

  /* Match Reset */
  function resetMatch(){
    state.score = {p:0, ai:0};
    scoreP.textContent = 0;
    scoreAI.textContent = 0;
    spawnEntities();
    state.kickoffTimer = 0;
  }

  /* Start Match */
  function initMatchFromMenu(){
    applyDifficulty(selectedDifficulty);
    updateWH();
    spawnEntities();
    state.ball.vel = mul(normalize({x:Math.random()-0.5,y:Math.random()-0.5}), 90);

    state.inMenu = false;
    state.paused = false;

    ui.classList.remove('hidden');
    mainMenu.classList.add('hidden');
    pauseMenu.classList.add('hidden');
  }

  /* Difficulty Presets */
  function applyDifficulty(diff){
    selectedDifficulty = diff;

    if(diff === 'easy'){
      settings.aiSkill = 0.35;
      settings.playerMaxSpeed = 260;
      settings.playerAccel = 1500;

      settings.ballMaxSpeed = 580;
      settings.kickPower = 330;
    }

    else if(diff === 'medium'){
      settings.aiSkill = 0.70;
      settings.playerMaxSpeed = 240;
      settings.playerAccel = 1600;

      settings.ballMaxSpeed = 820;
      settings.kickPower = 420;
    }

    else { // hard
      settings.aiSkill = 0.92;
      settings.playerMaxSpeed = 230;
      settings.playerAccel = 1900;

      settings.ballMaxSpeed = 980;
      settings.kickPower = 520;
    }
  }

  /* Menu Controls */
  startMatchBtn.addEventListener('click', () => initMatchFromMenu());

  pauseBtn.addEventListener('click', () => togglePause());
  resumeBtn.addEventListener('click', () => togglePause(false));

  changeDifficultyBtn.addEventListener('click', () => {
    mainMenu.classList.remove('hidden');
    pauseMenu.classList.add('hidden');
  });

  restartBtnUI.addEventListener('click', () => {
    resetMatch();
    togglePause(false);
  });

  function togglePause(force){
    if(state.inMenu) return;
    if(typeof force === 'boolean') state.paused = force;
    else state.paused = !state.paused;

    if(state.paused) pauseMenu.classList.remove('hidden');
    else pauseMenu.classList.add('hidden');
  }

  /* Initialize */
  function init(){
    updateWH();
    updateGrids();
    mainMenu.classList.remove('hidden');
    ui.classList.add('hidden');
    pauseMenu.classList.add('hidden');
    requestAnimationFrame(step);
  }

  init();
})();
