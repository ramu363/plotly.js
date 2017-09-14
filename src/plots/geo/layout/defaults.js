/**
* Copyright 2012-2017, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var Lib = require('../../../lib');
var handleSubplotDefaults = require('../../subplot_defaults');
var constants = require('../constants');
var layoutAttributes = require('./layout_attributes');

module.exports = function supplyLayoutDefaults(layoutIn, layoutOut, fullData) {
    handleSubplotDefaults(layoutIn, layoutOut, fullData, {
        type: 'geo',
        attributes: layoutAttributes,
        handleDefaults: handleGeoDefaults,
        partition: 'y'
    });
};

function handleGeoDefaults(geoLayoutIn, geoLayoutOut, coerce) {
    var show;

    var scope = coerce('scope');
    var isScoped = (scope !== 'world');
    var scopeParams = constants.scopeDefaults[scope];

    var resolution = coerce('resolution');
    coerce('position.x');
    coerce('position.y');

    var projType = coerce('projection.type', scopeParams.projType);
    var isAlbersUsa = projType === 'albers usa';
    var isConic = projType.indexOf('conic') !== -1;

    if(isConic) {
        var dfltProjParallels = scopeParams.projParallels || [0, 60];
        coerce('projection.parallels', dfltProjParallels);
    }

    if(!isAlbersUsa) {
        var dfltProjRotate = scopeParams.projRotate || [0, 0, 0];
        coerce('projection.rotation.lon', dfltProjRotate[0]);
        coerce('projection.rotation.lat', dfltProjRotate[1]);
        coerce('projection.rotation.roll', dfltProjRotate[2]);

        show = coerce('showcoastlines', !isScoped);
        if(show) {
            coerce('coastlinecolor');
            coerce('coastlinewidth');
        }

        show = coerce('showocean');
        if(show) coerce('oceancolor');
    } else {
        geoLayoutOut.scope = 'usa';
    }

    coerce('projection.scale');

    show = coerce('showland');
    if(show) coerce('landcolor');

    show = coerce('showlakes');
    if(show) coerce('lakecolor');

    show = coerce('showrivers');
    if(show) {
        coerce('rivercolor');
        coerce('riverwidth');
    }

    show = coerce('showcountries', isScoped && scope !== 'usa');
    if(show) {
        coerce('countrycolor');
        coerce('countrywidth');
    }

    if(scope === 'usa' || (scope === 'north america' && resolution === 50)) {
        // Only works for:
        //   USA states at 110m
        //   USA states + Canada provinces at 50m
        coerce('showsubunits', true);
        coerce('subunitcolor');
        coerce('subunitwidth');
    }

    if(!isScoped) {
        // Does not work in non-world scopes
        show = coerce('showframe', true);
        if(show) {
            coerce('framecolor');
            coerce('framewidth');
        }
    }

    coerce('bgcolor');

    geoAxisDefaults(geoLayoutIn, geoLayoutOut);

    // bind a few helper field that are used downstream
    geoLayoutOut._isScoped = isScoped;
    geoLayoutOut._isConic = isConic;
}

function geoAxisDefaults(geoLayoutIn, geoLayoutOut) {
    var axesNames = constants.axesNames;
    var axisName, axisIn, axisOut;

    function coerce(attr, dflt) {
        return Lib.coerce(axisIn, axisOut, layoutAttributes[axisName], attr, dflt);
    }

    function getRangeDflt() {
        var scope = geoLayoutOut.scope;

        if(scope === 'world') {
            var projLayout = geoLayoutOut.projection;
            var projType = projLayout.type;
            var projRotation = projLayout.rotation;
            var dfltSpans = constants[axisName + 'Span'];

            var halfSpan = dfltSpans[projType] !== undefined ?
                dfltSpans[projType] / 2 :
                dfltSpans['*'] / 2;

            var rotateAngle = axisName === 'lonaxis' ?
                projRotation.lon :
                projRotation.lat;

            return [rotateAngle - halfSpan, rotateAngle + halfSpan];
        } else {
            return constants.scopeDefaults[scope][axisName + 'Range'];
        }
    }

    for(var i = 0; i < axesNames.length; i++) {
        axisName = axesNames[i];
        axisIn = geoLayoutIn[axisName] || {};
        axisOut = {};

        var rangeDflt = getRangeDflt();
        var range = coerce('range', rangeDflt);

        Lib.noneOrAll(axisIn.range, axisOut.range, [0, 1]);

        coerce('tick0', range[0]);
        coerce('dtick', axisName === 'lonaxis' ? 30 : 10);

        var show = coerce('showgrid');
        if(show) {
            coerce('gridcolor');
            coerce('gridwidth');
        }

        geoLayoutOut[axisName] = axisOut;
        geoLayoutOut[axisName]._fullRange = rangeDflt;
    }
}
