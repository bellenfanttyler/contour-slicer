let lineSpacingSlider, thicknessSlider, rotationSlider, colorPicker;
let sliceXAngleSlider, sliceYAngleSlider, sliceZAngleSlider;
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

  lineSpacingSlider = createLabeledSlider("Line Spacing", 0.5, 50, 3, 0.5);
  thicknessSlider = createLabeledSlider("Line Thickness", 0.1, 5, 1, 0.1);
  sliceXAngleSlider = createLabeledSlider("Slicing Plane Rotation (X axis)", -7200, 7200, 5000, 1);
  sliceYAngleSlider = createLabeledSlider("Slicing Plane Rotation (Y axis)", -7200, 7200, 0, 1);
  sliceZAngleSlider = createLabeledSlider("Slicing Plane Rotation (Z axis)", -7200, 7200, 0, 1);
  rotationSlider = createLabeledSlider("Object Rotation (X axis)", 0, 360, 180, 1);

  createP("Fill Color");
  colorPicker = createColorPicker("#ffffff");

  createP();
  saveButton = createButton("Download SVG");
  saveButton.mousePressed(exportSVG);
}

function draw() {
  background(255);
  orbitControl();

  if (!modelData) return;

  let spacing = lineSpacingSlider.value();
  rotation = rotationSlider.value();
  let fillCol = colorPicker.color();

  stroke(0);
  strokeWeight(thicknessSlider.value());

  push();
  rotateX(rotation);
  rotateY(180)
  drawContours(spacing, fillCol);
  pop();
}

// ---- Contour Drawing with Fill ----

function drawContours(spacing, fillCol) {
  let { vertices, faces } = modelData;

  let xAngle = sliceXAngleSlider.value();
  let yAngle = sliceYAngleSlider.value();
  let zAngle = sliceZAngleSlider.value();

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

    let contours = buildContoursFromSegments(segments);

    for (let contour of contours) {
      fill(fillCol);
      beginShape();
      for (let pt of contour) {
        let p = rotateVectorX(pt, xAngle);
        p = rotateVectorY(p, yAngle);
        p = rotateVectorZ(p, zAngle);
        vertex(p.x, p.y, p.z);
      }
      endShape(CLOSE);
    }
  }
}

// ---- Contour Loop Stitcher ----

function buildContoursFromSegments(segments) {
  let contours = [];
  let used = new Set();

  let key = (v) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;

  while (used.size < segments.length) {
    let contour = [];
    let segIdx = segments.findIndex((_, idx) => !used.has(idx));
    if (segIdx === -1) break;

    let [start, end] = segments[segIdx];
    contour.push(start);
    contour.push(end);
    used.add(segIdx);

    let last = end;

    let closed = false;
    while (!closed) {
      closed = dist(contour[0].x, contour[0].y, contour[0].z, last.x, last.y, last.z) < 0.001;
      if (closed) break;

      let found = false;
      for (let i = 0; i < segments.length; i++) {
        if (used.has(i)) continue;
        let [a, b] = segments[i];

        if (pEquals(a, last)) {
          contour.push(b);
          last = b;
          used.add(i);
          found = true;
          break;
        } else if (pEquals(b, last)) {
          contour.push(a);
          last = a;
          used.add(i);
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (contour.length >= 3) {
      contours.push(contour);
    }
  }

  return contours;
}

function pEquals(p1, p2) {
  return p1.dist(p2) < 0.001;
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

  let scaleFactor = 200 / maxSize;

  normalizedVertices = rawVertices.map(v =>
    createVector(
      (v.x - center.x) * scaleFactor,
      (v.y - center.y) * scaleFactor,
      (v.z - center.z) * scaleFactor
    )
  );

  modelData = { vertices: normalizedVertices, faces };
}

// ---- Slicing Logic ----

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

// ---- Rotation Helpers ----

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

function applyMatrixToVector(matrix, v) {
  let x = v.x, y = v.y, z = v.z;
  let m = matrix.mat4; // 16-element Float32Array
  let out = createVector(
    m[0]*x + m[4]*y + m[8]*z + m[12],
    m[1]*x + m[5]*y + m[9]*z + m[13],
    m[2]*x + m[6]*y + m[10]*z + m[14]
  );
  return out;
}

function projectToScreen(v) {
  // Flip X and Y, and center to canvas dimensions
  let x = width / 2 - (v.x / v.z) * 300;
  let y = height / 2 - (v.y / v.z) * 300;
  return { x, y, z: v.z };
}


// ---- UI Helper ----

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

function exportSVG() {
  if (!modelData) return;

  let spacing = lineSpacingSlider.value();
  let xAngle = sliceXAngleSlider.value();
  let yAngle = sliceYAngleSlider.value();
  let zAngle = sliceZAngleSlider.value();
  let rotationAngle = rotationSlider.value();
  let strokeW = thicknessSlider.value();

  // Apply slicing-plane transform
  let transformed = modelData.vertices.map(v => {
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

  let paths = [];

  for (let i = 0; i < numSlices; i++) {
    let y = yMin + i * spacing + spacing / 2;
    let segments = [];

    for (let face of modelData.faces) {
      let v0 = transformed[face[0]];
      let v1 = transformed[face[1]];
      let v2 = transformed[face[2]];
      let segs = sliceTriangle(v0, v1, v2, y);
      if (segs.length > 0) {
        segments.push(...segs);
      }
    }

    let contours = buildContoursFromSegments(segments);

    for (let contour of contours) {
      // Re-apply original orientation
      let screenPoints = contour.map(p => {
        let worldPt = rotateVectorX(p, xAngle);
        worldPt = rotateVectorY(worldPt, yAngle);
        worldPt = rotateVectorZ(worldPt, zAngle);
        worldPt = rotateVectorX(worldPt, rotationAngle);
        worldPt = rotateVectorY(worldPt, 180); // model default rotation

        let modelView = _renderer.uMVMatrix.copy();
        let viewPt = applyMatrixToVector(modelView, worldPt);
        let screen = projectToScreen(viewPt);
        return screen;
      });

      // Use average Z to sort later
      let avgZ = screenPoints.reduce((acc, p) => acc + p.z, 0) / screenPoints.length;

      let d = `M ${screenPoints[0].x},${screenPoints[0].y} ` + 
              screenPoints.slice(1).map(p => `L ${p.x},${p.y}`).join(' ');
      paths.push({ d, z: avgZ });
    }
  }

  // Sort paths back-to-front
  paths.sort((a, b) => b.z - a.z);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">\n`;
  svg += `<g stroke="black" stroke-width="${strokeW}" fill="none">\n`;

  for (let { d } of paths) {
    svg += `<path d="${d}" />\n`;
  }

  svg += `</g>\n</svg>`;

  let blob = new Blob([svg], { type: "image/svg+xml" });
  let url = URL.createObjectURL(blob);
  let a = createA(url, 'contour_model.svg');
  a.attribute('download', 'contour_model.svg');
  a.hide();
  a.elt.click();
  URL.revokeObjectURL(url);
}
