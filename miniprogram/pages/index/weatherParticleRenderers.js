/**
 * Per-particle Canvas renderers for the homepage weather scene.
 *
 * Each renderer mutates one particle and emits the same Canvas calls as the
 * original drawParticles branch. Keep random calls in their existing order.
 */

function renderRainParticle(ctx, p, frame, random = Math.random) {
  const { width, height, gust } = frame;
  const currentVx = p.vx + gust * (p.layer * 0.45);
  p.x += currentVx;
  p.y += p.vy;

  if (p.y > height + p.length || p.x > width + 100 || p.x < -100) {
    p.y = -p.length - 10;
    p.x = random() * width * 1.4 - width * 0.2;
    p.length = p.baseLength * (0.8 + random() * 0.45);
    p.vy = p.baseVy * (0.9 + random() * 0.2);
  }

  let currentOpacity = p.opacity;
  if (p.y > height - 40) {
    currentOpacity *= Math.max(0, (height - p.y) / 40);
  }

  ctx.beginPath();
  ctx.strokeStyle = `rgba(50, 78, 108, ${currentOpacity * 0.40})`;
  ctx.lineWidth = p.thickness + 0.9;
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + currentVx * 1.25, p.y + p.vy * 1.25);
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = `rgba(255, 255, 255, ${currentOpacity * 0.95})`;
  ctx.lineWidth = p.thickness;
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + currentVx * 1.25, p.y + p.vy * 1.25);
  ctx.stroke();
}

function renderSnowParticle(ctx, p, frame, random = Math.random) {
  const { width, height, gust } = frame;
  const drift = p.vx + gust * (p.layer * 0.28);
  p.y += p.vy;
  p.x += drift + Math.sin(p.y * p.swingSpeed + p.swingOffset) * p.swingRange;

  if (p.y > height + 10 || p.x > width + 20 || p.x < -20) {
    p.y = -10;
    p.x = random() * width;
  }

  let currentOpacity = p.opacity;
  if (p.y > height - 35) {
    currentOpacity *= Math.max(0, (height - p.y) / 35);
  }

  ctx.beginPath();
  ctx.fillStyle = `rgba(70, 110, 155, ${currentOpacity * 0.35})`;
  ctx.arc(p.x, p.y, p.radius + 0.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = `rgba(255, 255, 255, ${currentOpacity * 0.95})`;
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.fill();
}

function renderLeafParticle(ctx, p, frame, random = Math.random) {
  const { width, height, windPhase, gust } = frame;
  p.x += p.vx + gust * 0.2 + Math.sin(windPhase * 1.0 + p.phase) * 0.2;
  p.y += p.vy + Math.cos(windPhase * 0.8 + p.phase) * 0.15;
  p.angle += p.rotSpeed;
  p.tumbleAngle += p.tumbleSpeed;

  if (p.x > width + 25 || p.y > height + 20) {
    p.x = -25;
    p.y = random() * height;
  }

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.scale(1, Math.cos(p.tumbleAngle));

  if (p.shape === "petal") {
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.moveTo(0, p.size * 0.7);
    ctx.bezierCurveTo(-p.size * 0.7, 0, -p.size * 0.7, -p.size * 0.7, 0, -p.size * 0.7);
    ctx.bezierCurveTo(p.size * 0.7, -p.size * 0.7, p.size * 0.7, 0, 0, p.size * 0.7);
    ctx.fill();
  } else if (p.shape === "ginkgo") {
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.moveTo(0, p.size * 0.7);
    ctx.quadraticCurveTo(-p.size * 0.9, -p.size * 0.3, -p.size * 0.6, -p.size * 0.8);
    ctx.quadraticCurveTo(0, -p.size * 0.5, p.size * 0.6, -p.size * 0.8);
    ctx.quadraticCurveTo(p.size * 0.9, -p.size * 0.3, 0, p.size * 0.7);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.moveTo(-p.size, 0);
    ctx.quadraticCurveTo(0, -p.size * 0.55, p.size, 0);
    ctx.quadraticCurveTo(0, p.size * 0.55, -p.size, 0);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = p.veinColor;
    ctx.lineWidth = 0.8;
    ctx.moveTo(-p.size * 0.8, 0);
    ctx.lineTo(p.size * 0.8, 0);
    ctx.stroke();
  }

  ctx.restore();
}

function renderSilkWindParticle(ctx, p, frame, random = Math.random) {
  const { width, height, windPhase, gust } = frame;
  p.x += p.vx + gust * (p.gustFactor || 0.2);
  p.y += p.vy;

  if (p.x > width + p.length + 15) {
    p.x = -p.length - 15;
    p.y = random() * height;
    p.vx = p.baseVx || p.vx;
  }

  const cp1x = p.x + p.length * 0.35;
  const cp1y = p.y - p.waveAmp * Math.sin(windPhase * 1.2 + p.phase);
  const cp2x = p.x + p.length * 0.7;
  const cp2y = p.y + p.waveAmp * Math.cos(windPhase * 1.2 + p.phase);
  const endX = p.x + p.length;
  const endY = p.y;

  // The glow and core used to allocate two almost-identical gradients for
  // every ribbon on every frame. A shared core gradient plus a low-alpha wide
  // stroke preserves the same soft highlight while halving those allocations.
  const gradient = ctx.createLinearGradient(p.x, p.y, endX, endY);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(0.35, `rgba(255, 255, 255, ${p.opacity})`);
  gradient.addColorStop(0.7, `rgba(255, 255, 255, ${p.opacity * 1.2})`);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  const previousGlobalAlpha = typeof ctx.globalAlpha === "number" && Number.isFinite(ctx.globalAlpha)
    ? ctx.globalAlpha
    : 1;

  ctx.beginPath();
  ctx.strokeStyle = gradient;
  ctx.globalAlpha = previousGlobalAlpha * 0.36;
  ctx.lineWidth = p.thickness * 2.2;
  ctx.moveTo(p.x, p.y);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
  ctx.stroke();

  ctx.beginPath();
  ctx.globalAlpha = previousGlobalAlpha;
  ctx.lineWidth = p.thickness;
  ctx.moveTo(p.x, p.y);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
  ctx.stroke();
}

function renderAirMoteParticle(ctx, p, frame, random = Math.random) {
  const { width, height, windPhase, gust } = frame;
  p.x += p.vx + gust * 0.2;
  p.y += p.vy + Math.sin(windPhase * 1.5 + p.phase) * 0.15;

  if (p.x > width + 10) {
    p.x = -10;
    p.y = random() * height;
  }

  const pulseAlpha = p.opacity * (0.6 + 0.4 * Math.sin(windPhase * 2 + p.phase));
  ctx.beginPath();
  ctx.fillStyle = `rgba(255, 255, 255, ${pulseAlpha})`;
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.fill();
}

module.exports = {
  renderRainParticle,
  renderSnowParticle,
  renderLeafParticle,
  renderSilkWindParticle,
  renderAirMoteParticle,
};
