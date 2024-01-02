

const shaderWGSL = `
struct VSInput {
  @builtin(instance_index) index: u32,
  @location(0) uv : vec2<f32>
}

struct VSOutput {
  @builtin(position) position: vec4f,
  @location(0) theta: f32,
  @location(1) radius : f32,
  @location(2) pointCoord : vec2<f32>,
  @location(3) pointRadius : f32
}

struct Uniforms {
  res : vec2<f32>,
  pixelRatio : f32,
  pointCount: f32
}

@binding(0) @group(0) var<uniform> uniforms : Uniforms;

const pi = ${Math.PI};
const baseAngle = pi * (1.0 + sqrt(5.0));
const pointBuffer = 0.5;

@vertex
fn vsmain(vIn: VSInput) -> VSOutput {
  var vOut : VSOutput;
  var idx = f32(vIn.index);
  var theta = idx * baseAngle;
  var rad = sqrt(idx / uniforms.pointCount);

  var pointRadius = 10.0;
  var pointOffset = vIn.uv / uniforms.res * ((pointRadius + pointBuffer) * uniforms.pixelRatio);
  var aspect = select(vec2<f32>(uniforms.res.y / uniforms.res.x, 1.0), vec2<f32>(1.0, uniforms.res.x / uniforms.res.y), uniforms.res.y > uniforms.res.x);
  vOut.position = vec4<f32>(
    aspect * vec2(cos(theta), sin(theta)) * rad * 0.9 + pointOffset,
    0.0, 1.0
  );
  vOut.theta = theta;

  vOut.radius = rad;
  vOut.pointRadius = pointRadius;
  vOut.pointCoord = vIn.uv;
  return vOut;
}

fn linearstep(edge0 : f32, edge1 : f32, value : f32) -> f32{
  return saturate((value - edge0) / (edge1 - edge0));
}

@fragment
fn fsmain(v: VSOutput) -> @location(0) vec4<f32> {
  var pointColor = mix(vec3<f32>(0.5),
    0.5 + 0.5 * vec3(
      cos(v.theta),
      cos(v.theta + (2.0 * pi / 3.0)),
      cos(v.theta + (4.0 * pi / 3.0))),
    v.radius * 0.0 + 1.0);
  var radius = length(v.pointCoord) * (v.pointRadius + pointBuffer);
  var borderRadius = 2.0;
  var borderColor = vec3(0.0);
  var color = mix(
    pointColor,
    borderColor,
    linearstep(v.pointRadius - borderRadius - 0.5, v.pointRadius - borderRadius + 0.5, radius)
  );
  var alpha = linearstep(v.pointRadius + 0.5, v.pointRadius - 0.5, radius);


  return vec4<f32>(pow(color, vec3(0.454)), 1.0) * alpha;
}
`;


const init = async ({ canvas }) => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const context = canvas.getContext('webgpu');

  const devicePixelRatio = window.devicePixelRatio;
  canvas.width = Math.floor(canvas.clientWidth * devicePixelRatio);
  canvas.height = Math.floor(canvas.clientHeight * devicePixelRatio);
  const format = navigator.gpu.getPreferredCanvasFormat();
  const alphaMode = 'premultiplied';

  context.configure({device, format, alphaMode});

  const spriteUVArray = new Float32Array([ 1, -1, 1, 1, -1, -1, -1, 1]);

  const spriteUVBuffer = device.createBuffer({
    size: spriteUVArray.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true
  });
  new Float32Array(spriteUVBuffer.getMappedRange()).set(spriteUVArray);
  spriteUVBuffer.unmap();

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({
        code: shaderWGSL
      }),
      entryPoint: 'vsmain',
      buffers: [{
        arrayStride: Float32Array.BYTES_PER_ELEMENT * 2,
        attributes: [{
          shaderLocation: 0,
          offset: 0,
          format: 'float32x2',
        }]
      }]
    },
    fragment: {
      module: device.createShaderModule({
        code: shaderWGSL
      }),
      entryPoint: 'fsmain',
      targets: [{
        format,
        blend: {
          color: {
            srcFactor: 'one',
            operation: 'add',
            dstFactor: 'one-minus-src-alpha'
          },
          alpha: {
            srcFactor: 'zero',
            dstFactor: 'one',
            operation: 'add'
          }
        }
      }],
    },
    primitive: {
      topology: 'triangle-strip',
    },
  });

  const uniformData = new Float32Array([canvas.width, canvas.height, devicePixelRatio, 0]);
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{
      binding: 0,
      resource: {
        buffer: uniformBuffer,
      },
    }],
  });

  function frame(t) {
    const w = Math.floor(canvas.clientWidth * devicePixelRatio);
    const h = Math.floor(canvas.clientHeight * devicePixelRatio);
    if (w !== canvas.width || h != canvas.height) {
      canvas.width = w;
      canvas.height = h;
      uniformData[0] = w;
      uniformData[1] = h;
    }

    const pointCount = 5000 * Math.pow(0.03 + 0.9 * (0.5 + 0.5 * Math.sin(t / 1000)), 2);

    uniformData[3] = pointCount;

    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const renderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };

    device.queue.writeBuffer(
      uniformBuffer,
      0,
      uniformData.buffer,
      0,
      uniformData.byteLength
    );

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, uniformBindGroup);
    passEncoder.setVertexBuffer(0, spriteUVBuffer);
    passEncoder.draw(4, Math.round(pointCount), 0, 0);
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
};


const canvas = document.getElementById('canvas');
init({canvas});

