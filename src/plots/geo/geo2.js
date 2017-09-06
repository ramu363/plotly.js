/**
* Copyright 2012-2017, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

/* global PlotlyGeoAssets:false */

var d3 = require('d3');

var Color = require('../../components/color');
var Drawing = require('../../components/drawing');
var Fx = require('../../components/fx');
var Plots = require('../plots');
var Axes = require('../cartesian/axes');

var createGeoScale = require('./set_scale');
var createGeoZoom = require('./zoom');
var createGeoZoomReset = require('./zoom_reset');
var constants = require('./constants');

var topojsonUtils = require('../../lib/topojson_utils');
var topojsonFeature = require('topojson-client').feature;

require('./projections')(d3);

function Geo(opts) {
    this.id = opts.id;
    this.graphDiv = opts.graphDiv;
    this.container = opts.container;
    this.topojsonURL = opts.topojsonURL;

    this.topojsonName = null;
    this.topojson = null;

    this.projectionType = null;
    this.projection = null;

    this.clipAngle = null;

    this.zoom = null;
    this.zoomReset = null;

    this.traceHash = {};
    this.layers = {};
    this.paths = {};
    this.points = {};

    this.makeFramework();
}

var proto = Geo.prototype;

module.exports = function createGeo(opts) {
    return new Geo(opts);
};

proto.plot = function(geoCalcData, fullLayout, promises) {
    var _this = this;
    var geoLayout = fullLayout[this.id];
    var topojsonNameNew = topojsonUtils.getTopojsonName(geoLayout);

    if(_this.topojson === null || topojsonNameNew !== _this.topojsonName) {
        _this.topojsonName = topojsonNameNew;

        if(PlotlyGeoAssets.topojson[_this.topojsonName] === undefined) {
            promises.push(_this.fetchTopojson(function(topojson) {
                PlotlyGeoAssets.topojson[_this.topojsonName] = topojson;
                _this.topojson = topojson;
                _this.update(geoCalcData, fullLayout);
            }));
        } else {
            _this.topojson = PlotlyGeoAssets.topojson[_this.topojsonName];
            _this.update(geoCalcData, fullLayout);
        }
    } else {
        _this.update(geoCalcData, fullLayout);
    }
};

proto.fetchTopojson = function(cb) {
    var topojsonPath = topojsonUtils.getTopojsonPath(
        this.topojsonURL,
        this.topojsonName
    );

    return new Promise(function(resolve, reject) {
        d3.json(topojsonPath, function(error, topojson) {
            if(error) {
                if(error.status === 404) {
                    reject(new Error([
                        'plotly.js could not find topojson file at',
                        topojsonPath, '.',
                        'Make sure the *topojsonURL* plot config option',
                        'is set properly.'
                    ].join(' ')));
                } else {
                    reject(new Error([
                        'unexpected error while fetching topojson file at',
                        topojsonPath
                    ].join(' ')));
                }
                return;
            }

            cb(topojson);
            resolve();
        });
    });
};

proto.update = function(geoCalcData, fullLayout) {
    var geoLayout = fullLayout[this.id];

    // setScale
    // zoom
    // zoomReset
    // other interaction stuff

    this.updateProjection(fullLayout, geoLayout);
    this.updateBaseLayers(fullLayout, geoLayout);
    this.updateDims(fullLayout, geoLayout);
    this.updateFx(fullLayout);

    Plots.generalUpdatePerTraceModule(this, geoCalcData, geoLayout);

    var scatterLayer = this.layers.frontplot.select('.scatterlayer');
    this.points.point = scatterLayer.selectAll('.point');
    this.points.text = scatterLayer.selectAll('text');

    var choroplethLayer = this.layers.backplot.select('.choroplethlayer');
    this.paths.choropleth = choroplethLayer.selectAll('path');

    this.render();
};

proto.updateProjection = function(fullLayout, geoLayout) {
    var projLayout = geoLayout.projection,
        projType = projLayout.type,
        isNew = this.projection === null || projType !== this.projectionType,
        projection;

    var setScale = createGeoScale(geoLayout, fullLayout._size);

    // add ...
    // - center
    // - translate
    // - scale

    if(isNew) {
        this.projectionType = projType;
        projection = this.projection = d3.geo[constants.projNames[projType]]();
    }
    else projection = this.projection;

    projection
        .translate(projLayout._translate0)
        .precision(constants.precision);

    if(!geoLayout._isAlbersUsa) {
        projection
            .rotate(projLayout._rotate)
            .center(projLayout._center);
    }

    if(geoLayout._clipAngle) {
        this.clipAngle = geoLayout._clipAngle;  // needed in proto.render
        projection
            .clipAngle(geoLayout._clipAngle - constants.clipPad);
    }
    else this.clipAngle = null;  // for graph edits

    if(projLayout.parallels) {
        projection
            .parallels(projLayout.parallels);
    }

    if(isNew) setScale(projection);

    projection
        .translate(projLayout._translate)
        .scale(projLayout._scale);
};


proto.updateBaseLayers = function(fullLayout, geoLayout) {
    var _this = this;
    var topojson = _this.topojson;
    var layers = _this.layers;
    var paths = _this.paths;

    function isAxisLayer(d) {
        return (d === 'lonaxis' || d === 'lataxis');
    }

    function isTopoLayer(d) {
        return (
            constants.fillLayers.indexOf(d) !== -1 ||
            constants.lineLayers.indexOf(d) !== -1
        );
    }

    var allLayers = geoLayout._hasChoropleth ?
        constants.layersForChoropleth :
        constants.layers;

    var layerData = allLayers.filter(function(d) {
        return isTopoLayer(d) ? geoLayout['show' + d] :
            isAxisLayer(d) ? geoLayout[d].showgrid :
            true;
    });

    var join = _this.framework.selectAll('.layer')
        .data(layerData, String);

    join.exit().remove();

    join.enter().append('g')
        .attr('class', function(d) { return 'layer ' + d; })
        .each(function(d) {
            var layer = layers[d] = d3.select(this);

            if(d === 'bg') {
                layer.append('rect');
            } else if(isAxisLayer(d)) {
                paths[d] = layer.append('path');
            } else if(d === 'backplot') {
                layer.append('g').classed('choroplethlayer', true);
            } else if(d === 'frontplot') {
                layer.append('g').classed('scatterlayer', true);
            } else if(isTopoLayer(d)) {
                paths[d] = layer.append('path');
            }
        });

    join.order();

    join.each(function(d) {
        var path = paths[d];
        var adj = constants.layerNameToAdjective[d];

        if(d === 'frame') {
            path.datum(constants.sphereSVG);
        } else if(isTopoLayer(d)) {
            // TODO try topojson.mesh !!!
            path.datum(topojsonFeature(topojson, topojson.objects[d]));
        } else if(isAxisLayer(d)) {
            path.datum(makeGraticule(d, geoLayout))
                .attr('fill', 'none')
                .call(Color.stroke, geoLayout[d].gridcolor)
                .call(Drawing.dashLine, '', geoLayout[d].gridwidth);
        }

        if(constants.fillLayers.indexOf(d) !== -1) {
            path
                .attr('stroke', 'none')
                .call(Color.fill, geoLayout[adj + 'color']);
        } else if(constants.lineLayers.indexOf(d) !== -1) {
            path
                .attr('fill', 'none')
                .call(Color.stroke, geoLayout[adj + 'color'])
                .call(Drawing.dashLine, '', geoLayout[adj + 'width']);
        }
    });
};

proto.updateDims = function(fullLayout, geoLayout) {
    var domain = geoLayout.domain;
    var gs = fullLayout._size;
    var left = gs.l + gs.w * domain.x[0] + geoLayout._marginX;
    var top = gs.t + gs.h * (1 - domain.y[1]) + geoLayout._marginY;

    Drawing.setTranslate(this.framework, left, top);

    var dimsAttrs = {
        x: 0,
        y: 0,
        width: geoLayout._width,
        height: geoLayout._height
    };

    this.clipRect.attr(dimsAttrs);

    this.layers.bg.select('rect')
        .attr(dimsAttrs)
        .call(Color.fill, geoLayout.bgcolor);

    this.xaxis._offset = left;
    this.xaxis._length = geoLayout._width;

    this.yaxis._offset = top;
    this.yaxis._length = geoLayout._height;
};

proto.updateFx = function() {

};

proto.makeFramework = function() {
    var fullLayout = this.graphDiv._fullLayout;
    var clipId = 'clip' + fullLayout._uid + this.id;

    var defGroup = fullLayout._defs.selectAll('g.clips')
        .data([0]);
    defGroup.enter().append('g')
        .classed('clips', true);

    this.clipDef = defGroup.append('clipPath')
        .attr('id', clipId);

    this.clipRect = this.clipDef.append('rect');

    this.framework = d3.select(this.container).append('g')
        .attr('class', 'geo ' + this.id)
        .style('pointer-events', 'all')
        .call(Drawing.setClipUrl, clipId);

    this.xaxis = {_id: 'x'};
    this.yaxis = {_id: 'y'};

    // mock axis for hover formatting
    this.mockAxis = {
        type: 'linear',
        showexponent: 'all',
        exponentformat: 'B'
    };
    Axes.setConvert(this.mockAxis);
};

proto.isLonLatOverEdges = function(lonlat) {
    var clipAngle = this.clipAngle;

    if(clipAngle === null) return false;

    var p = this.projection.rotate();
    var angle = d3.geo.distance(lonlat, [-p[0], -p[1]]);
    var maxAngle = clipAngle * Math.PI / 180;

    return angle > maxAngle;
};

// [hot code path] (re)draw all paths which depend on the projection
proto.render = function() {
    var _this = this;
    var pathFn = d3.geo.path().projection(_this.projection);
    var k;

    function translatePoints(d) {
        var lonlatPx = _this.projection(d.lonlat);
        return lonlatPx ?
            'translate(' + lonlatPx[0] + ',' + lonlatPx[1] + ')' :
             null;
    }

    function hideShowPoints(d) {
        return _this.isLonLatOverEdges(d.lonlat) ? 'none' : null;
    }

    for(k in _this.paths) {
        _this.paths[k].attr('d', pathFn);
    }

    for(k in _this.points) {
        _this.points[k]
            .attr('display', hideShowPoints)
            .attr('transform', translatePoints);
    }
};

function makeGraticule(axisName, geoLayout) {
    var axisLayout = geoLayout[axisName];

    // TODO shouldn't this be in supply-defaults?
    var scopeDefaults = constants.scopeDefaults[geoLayout.scope];
    var lonaxisRange = scopeDefaults.lonaxisRange;
    var lataxisRange = scopeDefaults.lataxisRange;
    var step = axisName === 'lonaxis' ?
        [axisLayout.dtick] :
        [0, axisLayout.dtick];

    return d3.geo.graticule()
        .extent([
            [lonaxisRange[0], lataxisRange[0]],
            [lonaxisRange[1], lataxisRange[1]]
        ])
        .step(step);
}
