/* ============================================================
   FLUID SOCCER - SPLIT VERSION
   ============================================================ */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");   // <-- FIXED: alpha TRUE

/* DOM REFS */
const mainMenu = document.getElementById("mainMenu");
const pauseMenu = document.getElementById("pauseMenu");
const ui = document.getElementById("ui");

const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const changeDifficultyBtn = document.getElementById("changeDifficultyBtn");
const restartBtnUI = document.getElementById("restartBtn");
const startMatchBtn = document.getElementById("startMatchBtn");

const scoreP = document.getElementById("scoreP");
const scoreAI = document.getElementById("scoreAI");

const playerColorChoices = document.getElementById("playerColorChoices");
const aiColorChoices = document.getElementById("aiColorChoices");
const difficultyChoices = document.getElementById("difficultyChoices");

/* COLORS */
const PALETTE = [
  "#ff4d4d", "#ffb84d", "#ffe74d", "#7dff4d", "#4dffa6",
  "#4dffff", "#4da6ff", "#7d4dff", "#ff4dff", "#ff4da6"
];

/* GAME VARIABLES */
let W, H;  // <-- FIXED

const field = { padding: 40 };

const settings = {
  playerRadius: 16,
  ballRadius: 14,
  kickPower: 420
};

let state = {
  players: [],
  ball: null,
  score: { p: 0, ai: 0 },
  lastTime: null,
  paused: false,
  inMenu: true
};

/* VECTORS */
const vec = (x=0,y=0)=>({x,y});
const add = (a,b)=>({x:a.x+b.x,y:a.y+b.y});
const mul = (a,s)=>({x:a.x*s,y:a.y*s});
const sub = (a,b)=>({x:a.x-b.x,y:a.y-b.y});
const len = a=>Math.hypot(a.x,a.y);
const normalize = a=>{ let L=len(a)||1; return {x:a.x/L,y:a.y/L}; };

/* MENU SELECTIONS */
let selectedPlayerColor = PALETTE[0];
let selectedAIColor = PALETTE[1];
let selectedDifficulty = "medium";

/* ======== RESIZE ======== */
function resize() {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  W = rect.width;
  H = rect.height;
}
window.addEventListener("resize", resize);
resize();

/* ======== UI BUILD ======== */
function buildColorGrid(container, selected, onSelect) {
  container.innerHTML = "";
  PALETTE.forEach(c => {
    const div = document.createElement("div");
    div.className = "colorChoice" + (c === selected ? " selected" : "");
    div.style.background = c;
    div.addEventListener("click", () => {
      onSelect(c);
      updateGrids();
    });
    container.appendChild(div);
  });
}

function updateGrids() {
  [...playerColorChoices.children]
    .forEach((el,i)=>el.classList.toggle("selected", PALETTE[i]===selectedPlayerColor));

  [...aiColorChoices.children]
    .forEach((el,i)=>el.classList.toggle("selected", PALETTE[i]===selectedAIColor));

  [...difficultyChoices.querySelectorAll("button")]
    .forEach(btn => btn.style.outline =
        (btn.dataset.diff === selectedDifficulty) ? "3px solid white" : "none"
    );
}

/* INITIAL COLOR GRIDS */
buildColorGrid(playerColorChoices, selectedPlayerColor, c => selectedPlayerColor=c);
buildColorGrid(aiColorChoices, selectedAIColor, c => selectedAIColor=c);
updateGrids();

/* ======== FIXED — DIFFICULTY BUTTON LOGIC ======== */
difficultyChoices.querySelectorAll("button").forEach(button => {
  button.addEventListener("click", () => {
    selectedDifficulty = button.dataset.diff;
    updateGrids();
  });
});

/* ======== ENTITIES ======== */
function createPlayer(x,y,type,color){
  return {
    type,
    pos:vec(x,y),
    vel:vec(0,0),
    radius:settings.playerRadius,
    color,
    kickCooldown:0
  };
}

function createBall(x,y){
  return { pos:vec(x,y), vel:vec(0,0), radius:settings.ballRadius, color:"#ffffff" };
}

function spawnEntities(){
  const leftX = field.padding + settings.playerRadius*2;
  const rightX = W - field.padding - settings.playerRadius*2;
  const midY = H/2;

  state.players = [
    createPlayer(leftX, midY, "player", selectedPlayerColor),
    createPlayer(rightX, midY, "ai", selectedAIColor)
  ];

  state.ball = createBall(W/2, H/2);
}

/* ======== KICK ======== */
function attemptKick(player, ball){
  if(player.kickCooldown > 0) return;
  const dir = sub(ball.pos, player.pos);
  if(len(dir) <= player.radius + ball.radius + 8){
    ball.vel = add(ball.vel, mul(normalize(dir), settings.kickPower));
    player.kickCooldown = 0.18;
  }
}

/* ======== DRAW ======== */
function drawPitch(){
  ctx.fillStyle = "#1f7a4c";
  ctx.fillRect(0,0,W,H);
}

function drawPlayer(p){
  ctx.save();
  ctx.translate(p.pos.x, p.pos.y);

  ctx.beginPath();
  ctx.ellipse(0,p.radius+8,p.radius*1.2,p.radius*0.5,0,0,Math.PI*2);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0,0,p.radius,0,Math.PI*2);
  ctx.fillStyle = p.color;
  ctx.fill();

  ctx.restore();
}

function drawBall(b){
  ctx.save();
  ctx.translate(b.pos.x, b.pos.y);

  ctx.beginPath();
  ctx.ellipse(4,b.radius+6,b.radius*1.2,b.radius*0.5,0,0,Math.PI*2);
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0,0,b.radius,0,Math.PI*2);
  ctx.fillStyle = b.color;
  ctx.fill();

  ctx.restore();
}

/* ======== UPDATE ======== */
function update(dt){
  state.players.forEach(p => {
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    if(p.kickCooldown>0) p.kickCooldown -= dt;
  });

  state.ball.pos.x += state.ball.vel.x * dt;
  state.ball.pos.y += state.ball.vel.y * dt;

  state.ball.vel.x *= 0.995;
  state.ball.vel.y *= 0.995;
}

/* ======== RENDER ======== */
function render(){
  ctx.clearRect(0,0,W,H);
  drawPitch();
  drawPlayer(state.players[0]);
  drawPlayer(state.players[1]);
  drawBall(state.ball);
}

/* ======== LOOP ======== */
function step(t){
  if(!state.lastTime) state.lastTime=t;

  let dt=(t-state.lastTime)/1000;
  state.lastTime=t;
  dt=Math.min(0.04,dt);

  if(!state.paused && !state.inMenu) update(dt);
  render();
  requestAnimationFrame(step);
}
requestAnimationFrame(step);

/* ======== MENUS ======== */
function initMatch(){
  spawnEntities();
  ui.classList.remove("hidden");
  mainMenu.classList.add("hidden");
  pauseMenu.classList.add("hidden");
  state.inMenu = false;
  state.paused = false;
}

startMatchBtn.addEventListener("click", initMatch);

pauseBtn.addEventListener("click", ()=>{
  state.paused = true;
  pauseMenu.classList.remove("hidden");
});

resumeBtn.addEventListener("click", ()=>{
  state.paused=false;
  pauseMenu.classList.add("hidden");
});

changeDifficultyBtn.addEventListener("click", ()=>{
  mainMenu.classList.remove("hidden");
  pauseMenu.classList.add("hidden");
});

restartBtnUI.addEventListener("click", ()=>{
  spawnEntities();
  state.score={p:0,ai:0};
  state.paused=false;
  pauseMenu.classList.add("hidden");
});

/* ======== INPUT ======== */
canvas.addEventListener("pointerdown", e=>{
  const b = state.ball;
  const d = Math.hypot(b.pos.x-e.offsetX, b.pos.y-e.offsetY);
  if(d <= b.radius+30) attemptKick(state.players[0], b);
});
