function createConfettiParticles(cx, cy, colors, count = 45) {
  const particles = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + (Math.random() * 0.2 - 0.1);
    const speed = 4 + Math.random() * 8;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (3 + Math.random() * 4),
      size: 5 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: -8 + Math.random() * 16,
      opacity: 1,
      gravity: 0.28,
      drag: 0.965,
    });
  }
  return particles;
}

function updateAndRenderConfetti(ctx, width, height, particles) {
  ctx.clearRect(0, 0, width, height);
  let activeParticles = 0;

  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    if (particle.opacity <= 0) continue;

    activeParticles += 1;

    particle.vx *= particle.drag;
    particle.vy *= particle.drag;
    particle.vy += particle.gravity;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.rotation += particle.rotationSpeed;
    particle.opacity -= 0.015;

    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate((particle.rotation * Math.PI) / 180);
    ctx.globalAlpha = Math.max(0, particle.opacity);
    ctx.fillStyle = particle.color;

    ctx.fillRect(-particle.size / 2, -particle.size, particle.size, particle.size * 2);
    ctx.restore();
  }

  if (activeParticles === 0) {
    ctx.clearRect(0, 0, width, height);
  }

  return activeParticles;
}

module.exports = {
  createConfettiParticles,
  updateAndRenderConfetti,
};
