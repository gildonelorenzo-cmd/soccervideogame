// Fluid Soccer — script.js
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  // crisp on high DPI
  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(600, Math.floor(rect.width * ratio));
    canvas.height = Math.max(300, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  window.addEventListener('resize', resize, { passive: true });
  resize();

  // UI
  const scoreP = document.getElementById('scoreP');
  const scoreAI = document.getElementById('scoreAI');
  document.getElementById('restart').addEventListener('click', resetMatch);

  // Game constants (in game units where canvas logical size maps to rect size)
  let W = canvas.clientWidth;
  let H = canvas.clientHeight;

  function updateWH() { W = canvas.clientWidth; H = canvas.clientHeight; }
  window.addEventListener('resize', updateWH);

  const field = {
    padding: 40,
    goalWidthRatio: 0.25, // fraction of field height
  };

  // Entities
  function vec(x=0,y=0){ return {x,y}; }
  function add(a,b){ return {x:a.x+b.x, y:a.y+b.y}; }
  function sub(a,b){ return {x:a.x-b.x, y:a.y-b.y}; }
  function mul(a,s){ return {x:a.x*s, y:a.y*s}; }
  function len(a){ return Math.hypot(a.x,a.y); }
  function normalize(a){ const L=len(a)||1; return {x:a.x/L, y:a.y/L}; }

  const settings = {
    playerRadius: 16,
    playerMaxSpeed: 420, // px/s
    playerAccel: 2600, // px/s^2
    playerFriction: 8,
    ballRadius: 9,
    ballMaxSpeed: 1400,
    ballFriction: 0.995, // multiplicative per frame (applied via dt)
    kickPower: 750, // impulse magnitude
    aiSkill: 0.86, // 0..1
    slowMotionOnKick: 0.95, // slight slowdown to feel weight
  };

  // Game state
  let state = {
    players: [],
    ball: null,
    score: { p:0, ai:0 },
    lastTime: null,
    running: true,
    kickoffTimer: 0,
  };

  // Utility: clamp
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

  // Initialize players and ball
  function spawnEntities() {
    const leftX = field.padding + settings.playerRadius*2;
    const rightX = W - field.padding - settings.playerRadius*2;
    const midY = H/2;

    state.players = [
      createPlayer(leftX, midY, 'player', { up:'w', down:'s', left:'a', right:'d', kick:' ' }),
      createPlayer(rightX, midY, 'ai')
    ];

    state.ball = createBall(W/2, H/2);
  }

  function createPlayer(x,y,type,controls=null){
    return {
      id: type === 'player' ? 'P' : 'A',
      type,
      pos: vec(x,y),
      vel: vec(0,0),
      radius: settings.playerRadius,
      color: type === 'player' ? '#fff' : '#ffe163',
      team: type === 'player' ? 'left' : 'right',
      controls,
      kickCooldown: 0,
      facing: vec(1,0),
    };
  }

  function createBall(x,y){
    return {
      pos: vec(x,y),
      vel: vec(0,0),
      radius: settings.ballRadius,
      color: '#e9f7ff',
    };
  }

  // Keyboard + touch
  const keys = {};
  window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  // Touch: simple pointer to move player
  let pointer = null;
  canvas.addEventListener('pointerdown', (e) => {
    pointer = { id: e.pointerId, x: e.offsetX, y: e.offsetY, down: true, time: Date.now() };
    // if tapped near ball -> kick
    const b = state.ball;
    const d = Math.hypot(b.pos.x - pointer.x, b.pos.y - pointer.y);
    if (d <= b.radius + 30) {
      attemptKick(state.players[0], b);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointer) return;
    if (e.pointerId !== pointer.id) return;
    pointer.x = e.offsetX; pointer.y = e.offsetY;
  });
  canvas.addEventListener('pointerup', (e) => { if (pointer && e.pointerId === pointer.id) pointer = null; });

  // Kick logic
  function attemptKick(player, ball) {
    if (player.kickCooldown > 0) return;
    const dir = sub(ball.pos, player.pos);
    const dist = len(dir);
    if (dist <= player.radius + ball.radius + 6) {
      const n = normalize(dir);
      // impart velocity — combine with current ball vel for continuity
      ball.vel = add(ball.vel, mul(n, settings.kickPower));
      // cap ball speed
      const sp = len(ball.vel);
      if (sp > settings.ballMaxSpeed) ball.vel = mul(normalize(ball.vel), settings.ballMaxSpeed);
      player.kickCooldown = 0.18; // seconds between kicks
      // slight slow-motion feel
      state.kickSlow = 0.08;
    }
  }

  // Physics: circle-circle collision and resolution
  function resolveCircleCollision(a, b) {
    const delta = sub(b.pos, a.pos);
    const dist = len(delta) || 0.0001;
    const overlap = a.radius + b.radius - dist;
    if (overlap > 0) {
      // Move them apart proportional to inverse mass (players heavier than ball)
      const massA = a.type === 'player' ? 2 : 0.6;
      const massB = b.type === 'player' ? 2 : 0.6;
      const total = massA + massB;
      const n = { x: delta.x / dist, y: delta.y / dist };
      // positional correction
      a.pos.x -= n.x * (overlap * (massB / total));
      a.pos.y -= n.y * (overlap * (massB / total));
      b.pos.x += n.x * (overlap * (massA / total));
      b.pos.y += n.y * (overlap * (massA / total));

      // velocity exchange (elastic-ish)
      const relVel = sub(b.vel, a.vel);
      const velAlongNormal = relVel.x * n.x + relVel.y * n.y;
      if (velAlongNormal > 0) return;
      const restitution = 0.7;
      const impulseMag = -(1 + restitution) * velAlongNormal / (1/massA + 1/massB);
      const impulse = mul(n, impulseMag);
      a.vel.x -= impulse.x / massA;
      a.vel.y -= impulse.y / massA;
      b.vel.x += impulse.x / massB;
      b.vel.y += impulse.y / massB;
    }
  }

  // Field drawing helpers
  function drawPitch() {
    const pad = field.padding;
    const gw = H * field.goalWidthRatio;
    // background pitch
    ctx.fillStyle = '#1f7a4c';
    ctx.fillRect(0, 0, W, H);

    // center line
    ctx.strokeStyle = '#dff3e6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W/2, pad/2);
    ctx.lineTo(W/2, H - pad/2);
    ctx.stroke();

    // center circle
    ctx.beginPath();
    ctx.arc(W/2, H/2, Math.min(W,H)/6, 0, Math.PI*2);
    ctx.stroke();

    // outer bounds
    ctx.strokeRect(pad/2, pad/2, W - pad, H - pad);

    // goals (simple boxes)
    ctx.fillStyle = '#0b2b18';
    const goalH = gw;
    const goalY = (H - goalH)/2;
    const goalDepth = 10;
    // left goal area
    ctx.fillRect(0, goalY, pad/2 + goalDepth, goalH);
    // right goal
    ctx.fillRect(W - (pad/2 + goalDepth), goalY, pad/2 + goalDepth, goalH);
  }

  // Draw utilities
  function drawPlayer(p) {
    ctx.save();
    ctx.translate(p.pos.x, p.pos.y);
    // shadow
    ctx.beginPath();
    ctx.ellipse(0, p.radius+8, p.radius*1.2, p.radius*0.5, 0, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();

    // body
    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, Math.PI*2);
    ctx.fillStyle = p.color;
    ctx.fill();

    // facing marker
    const f = normalize(p.facing);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(f.x * p.radius*1.2, f.y * p.radius*1.2);
    ctx.strokeStyle = '#0008';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  function drawBall(b) {
    ctx.save();
    ctx.translate(b.pos.x, b.pos.y);
    // shadow
    ctx.beginPath();
    ctx.ellipse(4, b.radius+6, b.radius*1.2, b.radius*0.5, 0, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI*2);
    ctx.fillStyle = b.color;
    ctx.fill();

    // subtle motion highlight
    ctx.beginPath();
    ctx.arc(-b.radius*0.4, -b.radius*0.4, b.radius*0.5, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();

    ctx.restore();
  }

  // Game loop
  function step(t) {
    if (!state.lastTime) state.lastTime = t;
    let dt = (t - state.lastTime) / 1000;
    state.lastTime = t;

    // apply brief slow-motion when kick occurs
    if (state.kickSlow) {
      dt *= settings.slowMotionOnKick;
      state.kickSlow -= dt;
      if (state.kickSlow < 0) state.kickSlow = 0;
    }

    // clamp dt to avoid jump after tab switch
    dt = Math.min(0.04, dt);

    update(dt);
    render();

    if (state.running) requestAnimationFrame(step);
  }

  // update physics & logic
  function update(dt) {
    // reduce kick cooldowns
    state.players.forEach(p => {
      p.kickCooldown = Math.max(0, p.kickCooldown - dt);
    });

    // input -> player 0
    const P = state.players[0];
    let moveDir = vec(0,0);
    if (pointer) {
      moveDir.x = pointer.x - P.pos.x;
      moveDir.y = pointer.y - P.pos.y;
    } else {
      if (keys['w'] || keys['arrowup']) moveDir.y -= 1;
      if (keys['s'] || keys['arrowdown']) moveDir.y += 1;
      if (keys['a'] || keys['arrowleft']) moveDir.x -= 1;
      if (keys['d'] || keys['arrowright']) moveDir.x += 1;
      if (keys[' ']) attemptKick(P, state.ball);
    }
    if (len(moveDir) > 0) {
      const nd = normalize(moveDir);
      P.facing = nd;
      // smooth acceleration toward target velocity
      const desired = mul(nd, settings.playerMaxSpeed);
      const deltaV = sub(desired, P.vel);
      const maxChange = settings.playerAccel * dt;
      const changeLen = len(deltaV);
      if (changeLen > maxChange) {
        const dv = mul(normalize(deltaV), maxChange);
        P.vel.x += dv.x; P.vel.y += dv.y;
      } else {
        P.vel.x = desired.x; P.vel.y = desired.y;
      }
    } else {
      // friction
      P.vel.x -= P.vel.x * clamp(settings.playerFriction * dt, 0, 1);
      P.vel.y -= P.vel.y * clamp(settings.playerFriction * dt, 0, 1);
      // small snap to zero
      if (Math.abs(P.vel.x) < 4) P.vel.x = 0;
      if (Math.abs(P.vel.y) < 4) P.vel.y = 0;
    }

    // AI: player 1
    const AI = state.players[1];
    runAI(AI, dt);

    // integrate players
    state.players.forEach(p => {
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      // limit to bounds (with padding)
      const pad = field.padding + p.radius + 2;
      p.pos.x = clamp(p.pos.x, pad, W - pad);
      p.pos.y = clamp(p.pos.y, pad, H - pad);
    });

    // ball physics
    const b = state.ball;
    // apply friction-like decay
    b.vel.x *= Math.pow(settings.ballFriction, dt*60);
    b.vel.y *= Math.pow(settings.ballFriction, dt*60);
    // cap speed
    const sp = len(b.vel);
    if (sp > settings.ballMaxSpeed) {
      b.vel = mul(normalize(b.vel), settings.ballMaxSpeed);
    }
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;

    // keep ball inside bounds (bounce off walls except through goals)
    const pad = field.padding;
    const goalH = H * field.goalWidthRatio;
    const goalY = (H - goalH)/2;
    // left wall
    if (b.pos.x - b.radius < pad/2) {
      // if within goal vertical span -> goal
      if (b.pos.y > goalY && b.pos.y < goalY + goalH) {
        scoreGoal('ai'); // AI scored (right side goal)
      } else {
        b.pos.x = pad/2 + b.radius;
        b.vel.x *= -0.78;
      }
    }
    // right wall
    if (b.pos.x + b.radius > W - pad/2) {
      if (b.pos.y > goalY && b.pos.y < goalY + goalH) {
        scoreGoal('p'); // Player scored
      } else {
        b.pos.x = W - pad/2 - b.radius;
        b.vel.x *= -0.78;
      }
    }
    // top/bottom
    if (b.pos.y - b.radius < pad/2) {
      b.pos.y = pad/2 + b.radius;
      b.vel.y *= -0.78;
    }
    if (b.pos.y + b.radius > H - pad/2) {
      b.pos.y = H - pad/2 - b.radius;
      b.vel.y *= -0.78;
    }

    // collisions: players <-> ball, players <-> players
    // player-player
    resolveCircleCollision(state.players[0], state.players[1]);
    // each player vs ball
    state.players.forEach(p => {
      resolveCircleCollision(p, b);
      // auto-kick if close and pressing kick / touching
      if (p.type === 'player') {
        if ((keys[' '] || pointer) && len(sub(b.pos, p.pos)) <= p.radius + b.radius + 6) {
          attemptKick(p, b);
        }
      } else {
        // AI may attempt kick inside its update logic
      }
    });

    // simple slowdown for small velocities to stop jitter
    if (len(b.vel) < 6) { b.vel.x = 0; b.vel.y = 0; }

    // kickoff timer: small pause after goal
    if (state.kickoffTimer > 0) {
      state.kickoffTimer -= dt;
      if (state.kickoffTimer <= 0) {
        // resume, place ball center
        state.ball.pos = vec(W/2, H/2);
        state.ball.vel = vec(0,0);
      }
    }
  }

  // AI logic: smooth, predictive movement and occasional strong kicks
  function runAI(ai, dt) {
    const b = state.ball;
    const toBall = sub(b.pos, ai.pos);
    const dist = len(toBall);
    const approach = normalize(toBall);

    // Predictive target: anticipate a bit ahead based on ball velocity
    const predict = add(b.pos, mul(b.vel, 0.16 * (1 - settings.aiSkill) + 0.08));
    const target = sub(predict, mul(approach, ai.radius * 1.6));
    const targVec = sub(target, ai.pos);
    const targDist = len(targVec);

    // Desired velocity
    let desire = vec(0,0);
    if (targDist > 6) {
      desire = mul(normalize(targVec), settings.playerMaxSpeed * (0.85 + 0.15 * settings.aiSkill));
    } else {
      desire = mul(normalize(sub(b.pos, ai.pos)), settings.playerMaxSpeed * 0.4);
    }

    // Blend smoothly into velocity (less twitchy)
    const blend = 0.12 + 0.5*(settings.aiSkill);
    ai.vel.x += (desire.x - ai.vel.x) * clamp(blend, 0, 1) * dt * 60;
    ai.vel.y += (desire.y - ai.vel.y) * clamp(blend, 0, 1) * dt * 60;

    // Face the ball
    if (len(sub(b.pos, ai.pos)) > 0.1) ai.facing = normalize(sub(b.pos, ai.pos));

    // If close enough and pointing toward player goal, kick toward goal
    const closeEnough = dist < ai.radius + b.radius + 14;
    if (closeEnough && ai.kickCooldown <= 0) {
      // choose kick direction: toward player's goal with some randomness
      const goal = vec(field.padding/2, H/2); // left goal center (AI kicks left)
      // if AI is on right side, kick left:
      const dir = normalize(sub(goal, b.pos));
      // add slight variation
      const jitter = (Math.random() - 0.5) * 0.25;
      const d2 = normalize(add(dir, mul({x:-dir.y,y:dir.x}, jitter)));
      b.vel = add(b.vel, mul(d2, settings.kickPower * (0.9 + 0.3*(1-settings.aiSkill))));
      ai.kickCooldown = 0.4;
      state.kickSlow = 0.06;
    }

    // clamp speed
    const sp = len(ai.vel);
    if (sp > settings.playerMaxSpeed) ai.vel = mul(normalize(ai.vel), settings.playerMaxSpeed);
  }

  function scoreGoal(who) {
    if (state.kickoffTimer > 0) return; // avoid double-scoring
    if (who === 'p') state.score.p++;
    if (who === 'ai') state.score.ai++;
    scoreP.textContent = state.score.p;
    scoreAI.textContent = state.score.ai;
    // show little pause
    state.kickoffTimer = 1.2;
    // place players to kickoff spots
    state.players[0].pos = vec(field.padding + settings.playerRadius*2, H/2);
    state.players[0].vel = vec(0,0);
    state.players[1].pos = vec(W - field.padding - settings.playerRadius*2, H/2);
    state.players[1].vel = vec(0,0);
    // place ball in middle after timer ends (handled in update)
  }

  // rendering
  function render() {
    // update W,H from canvas
    W = canvas.clientWidth; H = canvas.clientHeight;
    ctx.clearRect(0,0,W,H);
    drawPitch();
    // draw players and ball with subtle layer ordering
    drawBall(state.ball);
    // players
    // draw AI behind ball if further, else in front — simple depth hack
    const p0 = state.players[0], p1 = state.players[1];
    const d0 = Math.abs(p0.pos.y - state.ball.pos.y);
    const d1 = Math.abs(p1.pos.y - state.ball.pos.y);
    const playersSorted = [p0, p1].sort((a,b) => Math.abs(a.pos.y - state.ball.pos.y) - Math.abs(b.pos.y - state.ball.pos.y));
    // draw farther first
    drawPlayer(playersSorted[1]);
    drawPlayer(playersSorted[0]);
    // HUD: scores already in DOM
  }

  // reset / start
  function resetMatch() {
    state.score = { p:0, ai:0 };
    scoreP.textContent = 0;
    scoreAI.textContent = 0;
    spawnEntities();
    state.kickoffTimer = 0;
  }

  // on load
  function init() {
    updateWH();
    spawnEntities();
    // friendly initial velocities for feel
    state.ball.vel = mul(normalize({x: Math.random()-0.5, y: Math.random()-0.5}), 90);
    requestAnimationFrame(step);
  }

  // start
  init();

  // expose some tweaks in console for fun
  window._SOC = {
    state, settings, reset: resetMatch
  };
})();
