//////////////////////////////////////////////////////////////////////////////
/**
 * Create a new instance of lineFeature
 *
 * @class
 * @extends geo.lineFeature
 * @returns {geo.gl.lineFeature}
 */
//////////////////////////////////////////////////////////////////////////////
geo.gl.lineFeature = function (arg) {
  'use strict';
  if (!(this instanceof geo.gl.lineFeature)) {
    return new geo.gl.lineFeature(arg);
  }
  arg = arg || {};
  geo.lineFeature.call(this, arg);

  ////////////////////////////////////////////////////////////////////////////
  /**
   * @private
   */
  ////////////////////////////////////////////////////////////////////////////
  var m_this = this,
      s_exit = this._exit,
      m_actor = null,
      m_mapper = null,
      m_material = null,
      m_pixelWidthUnif = null,
      m_dynamicDraw = arg.dynamicDraw === undefined ? false : arg.dynamicDraw,
      s_init = this._init,
      s_update = this._update;

  function createVertexShader() {
    var vertexShaderSource = [
      '#ifdef GL_ES',
      '  precision highp float;',
      '#endif',
      'attribute vec3 pos;',
      'attribute vec3 prev;',
      'attribute vec3 next;',
      'attribute float offset;',

      'attribute vec3 strokeColor;',
      'attribute float strokeOpacity;',
      'attribute float strokeWidth;',

      'uniform mat4 modelViewMatrix;',
      'uniform mat4 projectionMatrix;',
      'uniform float pixelWidth;',

      'varying vec3 strokeColorVar;',
      'varying float strokeWidthVar;',
      'varying float strokeOpacityVar;',

      'void main(void)',
      '{',
      /* If any vertex has been deliberately set to a negative opacity,
       * skip doing computations on it. */
      '  if (strokeOpacity < 0.0) {',
      '    gl_Position = vec4(2, 2, 0, 1);',
      '    return;',
      '  }',
      '  const float PI = 3.14159265358979323846264;',
      '  vec4 worldPos = projectionMatrix * modelViewMatrix * vec4(pos.xyz, 1);',
      '  if (worldPos.w != 0.0) {',
      '    worldPos = worldPos/worldPos.w;',
      '  }',
      '  vec4 worldNext = projectionMatrix * modelViewMatrix * vec4(next.xyz, 1);',
      '  if (worldNext.w != 0.0) {',
      '    worldNext = worldNext/worldNext.w;',
      '  }',
      '  vec4 worldPrev = projectionMatrix* modelViewMatrix * vec4(prev.xyz, 1);',
      '  if (worldPrev.w != 0.0) {',
      '    worldPrev = worldPrev/worldPrev.w;',
      '  }',
      '  strokeColorVar = strokeColor;',
      '  strokeWidthVar = strokeWidth;',
      '  strokeOpacityVar = strokeOpacity;',
      '  vec2 deltaNext = worldNext.xy - worldPos.xy;',
      '  vec2 deltaPrev = worldPos.xy - worldPrev.xy;',
      '  float angleNext = PI * 0.5;',
      '  if (deltaNext.y < 0.0) { angleNext = -angleNext; } ',
      '  if (deltaNext.x != 0.0) {',
      '    angleNext = atan(deltaNext.y, deltaNext.x);',
      '  }',
      '  float anglePrev = PI * 0.5;',
      '  if (deltaPrev.y < 0.0) { anglePrev = -anglePrev; } ',
      '  if (deltaPrev.x != 0.0) {',
      '    anglePrev = atan(deltaPrev.y, deltaPrev.x);',
      '  }',
      '  if (deltaPrev.xy == vec2(0.0, 0.0)) anglePrev = angleNext;',
      '  if (deltaNext.xy == vec2(0.0, 0.0)) angleNext = anglePrev;',
      '  float angle = (anglePrev + angleNext) / 2.0;',
      '  float cosAngle = cos(anglePrev - angle);',
      '  if (cosAngle < 0.1) { cosAngle = sign(cosAngle) * 1.0; angle = 0.0; }',
      '  float distance = (offset * strokeWidth * pixelWidth) /',
      '                    cosAngle;',
      '  worldPos.x += distance * sin(angle);',
      '  worldPos.y -= distance * cos(angle);',
      '  gl_Position = worldPos;',
      '}'
    ].join('\n'),
    shader = new vgl.shader(gl.VERTEX_SHADER);
    shader.setShaderSource(vertexShaderSource);
    return shader;
  }

  function createFragmentShader() {
    var fragmentShaderSource = [
      '#ifdef GL_ES',
      '  precision highp float;',
      '#endif',
      'varying vec3 strokeColorVar;',
      'varying float strokeWidthVar;',
      'varying float strokeOpacityVar;',
      'void main () {',
      '  gl_FragColor = vec4 (strokeColorVar, strokeOpacityVar);',
      '}'
    ].join('\n'),
    shader = new vgl.shader(gl.FRAGMENT_SHADER);
    shader.setShaderSource(fragmentShaderSource);
    return shader;
  }

  function createGLLines() {
    var data = m_this.data(),
        i, j, k, v,
        numSegments = 0,
        lineItem, lineItemData,
        vert = [{}, {}], vertTemp,
        pos, posIdx3,
        position = [],
        posFunc = m_this.position(),
        strkWidthFunc = m_this.style.get('strokeWidth'),
        strkColorFunc = m_this.style.get('strokeColor'),
        strkOpacityFunc = m_this.style.get('strokeOpacity'),
        order = m_this.featureVertices(),
        buffers,
        posBuf, nextBuf, prevBuf, offsetBuf, indicesBuf,
        strokeWidthBuf, strokeColorBuf, strokeOpacityBuf,
        dest, dest3,
        geom = m_mapper.geometryData();

    for (i = 0; i < data.length; i += 1) {
      lineItem = m_this.line()(data[i], i);
      numSegments += lineItem.length - 1;
      for (j = 0; j < lineItem.length; j += 1) {
        pos = posFunc(lineItem[j], j, lineItem, i);
        if (pos instanceof geo.latlng) {
          position.push(pos.x());
          position.push(pos.y());
          position.push(0.0);
        } else {
          position.push(pos.x);
          position.push(pos.y);
          position.push(pos.z || 0.0);
        }
      }
    }

    position = geo.transform.transformCoordinates(
                 m_this.gcs(), m_this.layer().map().gcs(),
                 position, 3);

    buffers = vgl.DataBuffers(numSegments * order.length);
    posBuf           = buffers.create('pos', 3);
    nextBuf          = buffers.create('next', 3);
    prevBuf          = buffers.create('prev', 3);
    offsetBuf        = buffers.create('offset', 1);
    indicesBuf       = buffers.create('indices', 1);
    strokeWidthBuf   = buffers.create('strokeWidth', 1);
    strokeColorBuf   = buffers.create('strokeColor', 3);
    strokeOpacityBuf = buffers.create('strokeOpacity', 1);

    for (i = posIdx3 = dest = dest3 = 0; i < data.length; i += 1) {
      lineItem = m_this.line()(data[i], i);
      for (j = 0; j < lineItem.length; j += 1, posIdx3 += 3) {
        lineItemData = lineItem[j];
        /* swap entries in vert so that vert[0] is the first vertex, and
         * vert[1] will be reused for the second vertex */
        if (j) {
          vertTemp = vert[0];
          vert[0] = vert[1];
          vert[1] = vertTemp;
        }
        vert[1].pos = posIdx3;
        vert[1].prev = posIdx3 - (j ? 3 : 0);
        vert[1].next = posIdx3 + (j + 1 < lineItem.length ? 3 : 0);
        vert[1].strokeWidth = strkWidthFunc(lineItemData, j, lineItem, i);
        vert[1].strokeColor = strkColorFunc(lineItemData, j, lineItem, i);
        vert[1].strokeOpacity = strkOpacityFunc(lineItemData, j, lineItem, i);
        if (j) {
          for (k = 0; k < order.length; k += 1, dest += 1, dest3 += 3) {
            v = vert[order[k][0]];
            posBuf[dest3]     = position[v.pos];
            posBuf[dest3 + 1] = position[v.pos + 1];
            posBuf[dest3 + 2] = position[v.pos + 2];
            prevBuf[dest3]     = position[v.prev];
            prevBuf[dest3 + 1] = position[v.prev + 1];
            prevBuf[dest3 + 2] = position[v.prev + 2];
            nextBuf[dest3]     = position[v.next];
            nextBuf[dest3 + 1] = position[v.next + 1];
            nextBuf[dest3 + 2] = position[v.next + 2];
            offsetBuf[dest] = order[k][1];
            indicesBuf[dest] = dest;
            strokeWidthBuf[dest] = v.strokeWidth;
            strokeColorBuf[dest3]     = v.strokeColor.r;
            strokeColorBuf[dest3 + 1] = v.strokeColor.g;
            strokeColorBuf[dest3 + 2] = v.strokeColor.b;
            strokeOpacityBuf[dest] = v.strokeOpacity;
          }
        }
      }
    }

    geom.sourceByName('pos').setData(buffers.get('pos'));
    geom.sourceByName('prev').setData(buffers.get('prev'));
    geom.sourceByName('next').setData(buffers.get('next'));
    geom.sourceByName('strokeWidth').setData(buffers.get('strokeWidth'));
    geom.sourceByName('strokeColor').setData(buffers.get('strokeColor'));
    geom.sourceByName('strokeOpacity').setData(buffers.get('strokeOpacity'));
    geom.sourceByName('offset').setData(buffers.get('offset'));
    geom.primitive(0).setIndices(buffers.get('indices'));
    geom.boundsDirty(true);
    m_mapper.modified();
    m_mapper.boundsDirtyTimestamp().modified();
  }

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Return the arrangement of vertices used for each line segment.
   *
   * @returns {Number}
   */
  ////////////////////////////////////////////////////////////////////////////
  this.featureVertices = function () {
    return [[0, 1], [1, -1], [0, -1], [0, 1], [1, 1], [1, -1]];
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Return the number of vertices used for each line segment.
   *
   * @returns {Number}
   */
  ////////////////////////////////////////////////////////////////////////////
  this.verticesPerFeature = function () {
    return this.featureVertices().length;
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Initialize
   */
  ////////////////////////////////////////////////////////////////////////////
  this._init = function (arg) {
    var prog = vgl.shaderProgram(),
        vs = createVertexShader(),
        fs = createFragmentShader(),
        // Vertex attributes
        posAttr = vgl.vertexAttribute('pos'),
        prvAttr = vgl.vertexAttribute('prev'),
        nxtAttr = vgl.vertexAttribute('next'),
        offAttr = vgl.vertexAttribute('offset'),
        strkWidthAttr = vgl.vertexAttribute('strokeWidth'),
        strkColorAttr = vgl.vertexAttribute('strokeColor'),
        strkOpacityAttr = vgl.vertexAttribute('strokeOpacity'),
        // Shader uniforms
        mviUnif = new vgl.modelViewUniform('modelViewMatrix'),
        prjUnif = new vgl.projectionUniform('projectionMatrix'),
        geom = vgl.geometryData(),
        // Sources
        posData = vgl.sourceDataP3fv({'name': 'pos'}),
        prvPosData = vgl.sourceDataAnyfv(
            3, vgl.vertexAttributeKeysIndexed.Four, {'name': 'prev'}),
        nxtPosData = vgl.sourceDataAnyfv(
            3, vgl.vertexAttributeKeysIndexed.Five, {'name': 'next'}),
        offPosData = vgl.sourceDataAnyfv(
            1, vgl.vertexAttributeKeysIndexed.Six, {'name': 'offset'}),
        strkWidthData = vgl.sourceDataAnyfv(
            1, vgl.vertexAttributeKeysIndexed.One, {'name': 'strokeWidth'}),
        strkColorData = vgl.sourceDataAnyfv(
            3, vgl.vertexAttributeKeysIndexed.Two, {'name': 'strokeColor'}),
        strkOpacityData = vgl.sourceDataAnyfv(
            1, vgl.vertexAttributeKeysIndexed.Three,
            {'name': 'strokeOpacity'}),
        // Primitive indices
        triangles = vgl.triangles();

    m_pixelWidthUnif =  new vgl.floatUniform('pixelWidth',
                          1.0 / m_this.renderer().width());
    s_init.call(m_this, arg);
    m_material = vgl.material();
    m_mapper = vgl.mapper({dynamicDraw: m_dynamicDraw});

    prog.addVertexAttribute(posAttr, vgl.vertexAttributeKeys.Position);
    prog.addVertexAttribute(strkWidthAttr, vgl.vertexAttributeKeysIndexed.One);
    prog.addVertexAttribute(strkColorAttr, vgl.vertexAttributeKeysIndexed.Two);
    prog.addVertexAttribute(strkOpacityAttr, vgl.vertexAttributeKeysIndexed.Three);
    prog.addVertexAttribute(prvAttr, vgl.vertexAttributeKeysIndexed.Four);
    prog.addVertexAttribute(nxtAttr, vgl.vertexAttributeKeysIndexed.Five);
    prog.addVertexAttribute(offAttr, vgl.vertexAttributeKeysIndexed.Six);

    prog.addUniform(mviUnif);
    prog.addUniform(prjUnif);
    prog.addUniform(m_pixelWidthUnif);

    prog.addShader(fs);
    prog.addShader(vs);

    m_material.addAttribute(prog);
    m_material.addAttribute(vgl.blend());

    m_actor = vgl.actor();
    m_actor.setMaterial(m_material);
    m_actor.setMapper(m_mapper);

    geom.addSource(posData);
    geom.addSource(prvPosData);
    geom.addSource(nxtPosData);
    geom.addSource(strkWidthData);
    geom.addSource(strkColorData);
    geom.addSource(strkOpacityData);
    geom.addSource(offPosData);
    geom.addPrimitive(triangles);
    m_mapper.setGeometryData(geom);
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Return list of actors
   *
   * @returns {vgl.actor[]}
   */
  ////////////////////////////////////////////////////////////////////////////
  this.actors = function () {
    if (!m_actor) {
      return [];
    }
    return [m_actor];
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Build
   *
   * @override
   */
  ////////////////////////////////////////////////////////////////////////////
  this._build = function () {
    if (m_actor) {
      m_this.renderer().contextRenderer().removeActor(m_actor);
    }

    createGLLines();

    m_this.renderer().contextRenderer().addActor(m_actor);
    m_this.buildTime().modified();
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Update
   *
   * @override
   */
  ////////////////////////////////////////////////////////////////////////////
  this._update = function () {
    s_update.call(m_this);

    if (m_this.dataTime().getMTime() >= m_this.buildTime().getMTime() ||
        m_this.updateTime().getMTime() <= m_this.getMTime()) {
      m_this._build();
    }

    m_pixelWidthUnif.set(1.0 / m_this.renderer().width());
    m_actor.setVisible(m_this.visible());
    m_actor.material().setBinNumber(m_this.bin());
    m_this.updateTime().modified();
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Destroy
   */
  ////////////////////////////////////////////////////////////////////////////
  this._exit = function () {
    m_this.renderer().contextRenderer().removeActor(m_actor);
    s_exit();
  };

  this._init(arg);
  return this;
};

inherit(geo.gl.lineFeature, geo.lineFeature);

// Now register it
geo.registerFeature('vgl', 'line', geo.gl.lineFeature);
