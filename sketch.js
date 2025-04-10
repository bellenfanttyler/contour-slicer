let lineSpacingSlider, thicknessSlider, rotationSlider, colorPicker;
let saveButton;

let modelData;
let normalizedVertices = [];
let rotation = 0;

function preload() {
  loadStrings('FinalBaseMesh.obj', parseOBJ);
}

function setup() {
  createCanvas(600, 600, WEBGL);
  angleMode(DEGREES);
  noFill();

  lineSpacingSlider = createLabeledSlider("Line Spacing", 1, 50, 10, 1);
  thicknessSlider = createLabeledSlider("Line Thickness", 0.1, 5, 1, 0.1);
  sliceXAngleSlider = createLabeledSlider("Slicing Plane Rotation (X axis)", -7200, 7200, 0, 1);
  sliceYAngleSlider = createLabeledSlider("Slicing Plane Rotation (Y axis)", -7200, 7200, 0, 1);
  sliceZAngleSlider = createLabeledSlider("Slicing Plane Rotation (Z axis)", -7200, 7200, 0, 1);
  rotationSlider = createLabeledSlider("Object Rotation (X axis)", 0, 360, 0, 1);

  createP("Line Color");
  colorPicker = createColorPicker("#000000");

  createP();
  saveButton = createButton("Download SVG");
  saveButton.mousePressed(() => save("contour_model.svg"));
}

function draw() {
  background(255);
  orbitControl();

  if (!modelData) return;

  let spacing = lineSpacingSlider.value();
  let thickness = thicknessSlider.value();
  rotation = rotationSlider.value();
  let lineCol = colorPicker.color();

  stroke(lineCol);
  strokeWeight(thickness);
  noFill();

  push();
  rotateX(rotation);
  drawContours(spacing);
  pop();
}

// ---- OBJ Parser and Normalizer ----

function parseOBJ(lines) {
  let rawVertices = [];
  let faces = [];

  for (let line of lines) {
    let parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') {
      let x = parseFloat(parts[1]);
      let y = parseFloat(parts[2]);
      let z = parseFloat(parts[3]);
      rawVertices.push(createVector(x, y, z));
    } else if (parts[0] === 'f') {
      let f = parts.slice(1).map(p => parseInt(p.split('/')[0]) - 1);
      if (f.length >= 3) {
        for (let i = 1; i < f.length - 1; i++) {
          faces.push([f[0], f[i], f[i + 1]]);
        }
      }
    }
  }

  // Normalize: center at origin, scale to fit canvas
  let bounds = getModelBounds(rawVertices);
  let center = createVector(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2
  );

  let maxSize = max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ
  );

  let scaleFactor = 200 / maxSize; // Scale model to ~200 units in size

  normalizedVertices = rawVertices.map(v =>
    createVector(
      (v.x - center.x) * scaleFactor,
      (v.y - center.y) * scaleFactor,
      (v.z - center.z) * scaleFactor
    )
  );

  modelData = { vertices: normalizedVertices, faces };
}

function drawContours(spacing) {
  let { vertices, faces } = modelData;

  let xAngle = sliceXAngleSlider.value();
  let yAngle = sliceYAngleSlider.value();
  let zAngle = sliceZAngleSlider.value();

  // Rotate all vertices into slice-aligned frame (reverse order of transform)
  let transformed = vertices.map(v => {
    let p = v.copy();
    p = rotateVectorZ(p, -zAngle);
    p = rotateVectorY(p, -yAngle);
    p = rotateVectorX(p, -xAngle);
    return p;
  });

  let bounds = getModelBounds(transformed);
  let yMin = bounds.minY;
  let yMax = bounds.maxY;
  let numSlices = floor((yMax - yMin) / spacing);

  for (let i = 0; i < numSlices; i++) {
    let y = yMin + i * spacing + spacing / 2;
    let segments = [];

    for (let face of faces) {
      let v0 = transformed[face[0]];
      let v1 = transformed[face[1]];
      let v2 = transformed[face[2]];

      let segs = sliceTriangle(v0, v1, v2, y);
      if (segs.length > 0) {
        segments.push(...segs);
      }
    }

    // Rotate slices back into original orientation
    for (let seg of segments) {
      let a = seg[0];
      let b = seg[1];
      a = rotateVectorX(a, xAngle);
      a = rotateVectorY(a, yAngle);
      a = rotateVectorZ(a, zAngle);

      b = rotateVectorX(b, xAngle);
      b = rotateVectorY(b, yAngle);
      b = rotateVectorZ(b, zAngle);

      line(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
}

function sliceTriangle(v0, v1, v2, yPlane) {
  let points = [];
  let edges = [[v0, v1], [v1, v2], [v2, v0]];

  for (let [a, b] of edges) {
    if ((a.y - yPlane) * (b.y - yPlane) < 0) {
      let t = (yPlane - a.y) / (b.y - a.y);
      let x = lerp(a.x, b.x, t);
      let z = lerp(a.z, b.z, t);
      points.push(createVector(x, yPlane, z));
    }
  }

  return points.length === 2 ? [[points[0], points[1]]] : [];
}

function getModelBounds(vertices) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function rotateVectorX(v, angle) {
  let rad = radians(angle);
  let cosA = cos(rad);
  let sinA = sin(rad);
  let y = v.y * cosA - v.z * sinA;
  let z = v.y * sinA + v.z * cosA;
  return createVector(v.x, y, z);
}

function rotateVectorY(v, angle) {
  let rad = radians(angle);
  let cosA = cos(rad);
  let sinA = sin(rad);
  let x = v.x * cosA + v.z * sinA;
  let z = -v.x * sinA + v.z * cosA;
  return createVector(x, v.y, z);
}

function rotateVectorZ(v, angle) {
  let rad = radians(angle);
  let cosA = cos(rad);
  let sinA = sin(rad);
  let x = v.x * cosA - v.y * sinA;
  let y = v.x * sinA + v.y * cosA;
  return createVector(x, y, v.z);
}

function createLabeledSlider(labelText, min, max, value, step) {
  createP(labelText);
  let container = createDiv();

  let slider = createSlider(min, max, value, step);
  let input = createInput(value.toString());
  input.size(50);

  container.child(slider);
  container.child(input);

  slider.input(() => {
    input.value(slider.value());
  });

  input.input(() => {
    let val = parseFloat(input.value());
    if (!isNaN(val)) {
      slider.value(val);
    }
  });

  return slider;
}
