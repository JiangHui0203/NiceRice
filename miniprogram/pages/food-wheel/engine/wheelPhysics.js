const morandiPresets = [
  { bg: "#D1E7DD", text: "#0F5132" }, // Soft Mint
  { bg: "#F8D7DA", text: "#842029" }, // Soft Rose
  { bg: "#FFF3CD", text: "#664D03" }, // Soft Butter
  { bg: "#CFF4FC", text: "#055160" }, // Soft Sky
  { bg: "#E2D9F3", text: "#432874" }, // Soft Lavender
  { bg: "#E8E2D8", text: "#494237" }, // Soft Oat
  { bg: "#D3E3FD", text: "#0B57D0" }, // Soft Periwinkle
  { bg: "#FFE8D6", text: "#7C2D12" }, // Soft Peach
  { bg: "#D8E2DC", text: "#283618" }, // Soft Sage
  { bg: "#F3C4FB", text: "#581C87" }, // Soft Lilac
];

function calculateWheelSlices(activeItems, mode, maxSafetyWidth, baseFontSize) {
  const count = activeItems.length;
  if (count === 0) {
    return {
      conicGradientStyle: "conic-gradient(#fbfaf7 0% 100%)",
      wheelSlices: [],
    };
  }

  const weights = activeItems.map((item) => (mode === "weighted" ? (item.weight || 2) : 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const gradientStops = [];
  const wheelSlices = [];
  let accumulatedAngle = 0;

  activeItems.forEach((item, index) => {
    const sliceAngle = 360 * (weights[index] / totalWeight);
    const startAngle = accumulatedAngle;
    const endAngle = startAngle + sliceAngle;
    const midAngle = startAngle + sliceAngle / 2;

    const preset = morandiPresets[index % morandiPresets.length];
    const color = preset.bg;
    const textColor = preset.text;

    gradientStops.push(`#ffffff ${startAngle}deg ${startAngle + 0.5}deg`);
    gradientStops.push(`${color} ${startAngle + 0.5}deg ${endAngle - 0.5}deg`);
    gradientStops.push(`#ffffff ${endAngle - 0.5}deg ${endAngle}deg`);

    const isHighScore = item.source === "coupon" && item.score >= 80;
    let title = item.title;
    if (isHighScore) {
      title = `✨${title}`;
    }

    const maxSingleLineChars = Math.max(4, Math.floor(maxSafetyWidth / baseFontSize));
    let isMultiline = false;
    let fontSize = baseFontSize;
    let maxWidth = maxSafetyWidth;

    if (title.length > maxSingleLineChars) {
      isMultiline = true;
      fontSize = Math.max(15, Math.floor(baseFontSize * 0.85));
      maxWidth = Math.floor(maxSafetyWidth * 0.65);
    }

    if (title.length > 12) {
      title = `${title.substring(0, 11)}...`;
    }

    wheelSlices.push({
      id: item.id,
      title,
      midAngle,
      isHighScore,
      fontSize,
      isMultiline,
      maxWidth,
      textColor,
    });

    accumulatedAngle += sliceAngle;
  });

  return {
    conicGradientStyle: `conic-gradient(${gradientStops.join(", ")})`,
    wheelSlices,
  };
}

function computeTargetAngle(activeItems, targetIndex, mode, currentAngleDegrees = 0) {
  const weights = activeItems.map((item) => (mode === "weighted" ? (item.weight || 2) : 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let accumulatedDegrees = 0;
  let targetMidDegrees = 0;
  for (let index = 0; index < activeItems.length; index += 1) {
    const sliceDegrees = 360 * (weights[index] / totalWeight);
    if (index === targetIndex) {
      targetMidDegrees = accumulatedDegrees + sliceDegrees / 2;
      break;
    }
    accumulatedDegrees += sliceDegrees;
  }

  const baseTargetDegrees = -targetMidDegrees;
  return baseTargetDegrees + 2160 + Math.ceil(currentAngleDegrees / 360) * 360;
}

module.exports = {
  morandiPresets,
  calculateWheelSlices,
  computeTargetAngle,
};
