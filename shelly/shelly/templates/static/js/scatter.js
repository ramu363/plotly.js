(function() {
var scatter = window.Plotly.Scatter = {};

scatter.PTS_LINESONLY = 20; // traces with < this many points are by default shown with points and lines, > just get lines

scatter.calc = function(gd,gdc) {
    // verify that data exists, and make scaled data if necessary
    if(!('y' in gdc) && !('x' in gdc)) { return; } // no data!

    var cd = [];

    // ignore as much processing as possible (and including in autorange) if trace is not visible
    if(gdc.visible===false) {
        // even if trace is not visible, need to figure out whether there are enough
        // points to trigger auto-no-lines
        if(gdc.mode || ((!gdc.x || gdc.x.length<scatter.PTS_LINESONLY) &&
          (!gdc.y || gdc.y.length<scatter.PTS_LINESONLY))) {
            return [{x:false, y:false}];
        }
        else {
            for(i=0; i<scatter.PTS_LINESONLY+1; i++) { cd.push({x:false, y:false}); }
            return cd;
        }
    }

    var xa = Plotly.Axes.getFromId(gd,gdc.xaxis||'x'),
        ya = Plotly.Axes.getFromId(gd,gdc.yaxis||'y'),
        x = Plotly.Axes.convertOne(gdc,'x',xa),
        y = Plotly.Axes.convertOne(gdc,'y',ya),
        serieslen = Math.min(x.length,y.length);

    // cancel minimum tick spacings (only applies to bars and boxes)
    xa._minDtick = 0;
    ya._minDtick = 0;

    if(x.length>serieslen) { x.splice(serieslen,x.length-serieslen); }
    if(y.length>serieslen) { y.splice(serieslen,y.length-serieslen); }

    // check whether bounds should be tight, padded, extended to zero...
    // most cases both should be padded on both ends, so start with that.
    var xOptions = {padded:true},
        yOptions = {padded:true};
    // include marker size
    if(gdc.mode && gdc.mode.indexOf('markers')!=-1) {
        var markerPad = gdc.marker ? gdc.marker.size : 0;
        markerTrans = function(v) { return (v||6)/1.6; };
        xOptions.ppad = yOptions.ppad = $.isArray(markerPad) ?
            markerPad.map(markerTrans) : markerTrans(markerPad);
    }
    // TODO: text size

    // include zero (tight) and extremes (padded) if fill to zero
    if(gdc.fill=='tozerox' || (gdc.fill=='tonextx' && gd.firstscatter)) {
        xOptions.tozero = true;
    }
    // if no error bars, markers or text, or fill to y=0 remove x padding
    else if((!gdc.error_y || !gdc.error_y.visible) &&
        (['tonexty','tozeroy'].indexOf(gdc.fill)!=-1 ||
        (gdc.mode && gdc.mode.indexOf('markers')==-1 && gdc.mode.indexOf('text')==-1) || // explicit no markers/text
        (!gdc.mode && serieslen>=scatter.PTS_LINESONLY))) { // automatic no markers
            xOptions.padded = false;
            xOptions.ppad = 0;
    }

    // now check for y - rather different logic, though still mostly padded both ends
    // include zero (tight) and extremes (padded) if fill to zero
    if(gdc.fill=='tozeroy' || (gdc.fill=='tonexty' && gd.firstscatter)) {
        yOptions.tozero = true;
    }
    // tight y: any x fill
    else if(['tonextx','tozerox'].indexOf(gdc.fill)!=-1) {
        yOptions.padded = false;
    }

    Plotly.Axes.expand(xa, x, xOptions);
    Plotly.Axes.expand(ya, y, yOptions);

    // create the "calculated data" to plot
    for(i=0;i<serieslen;i++) {
        cd.push(($.isNumeric(x[i]) && $.isNumeric(y[i])) ? {x:x[i],y:y[i]} : {x:false, y:false});
    }
    gd.firstscatter = false;
    return cd;
};

scatter.plot = function(gd,plotinfo,cdscatter) {
    var xa = plotinfo.x,
        ya = plotinfo.y;
    // make the container for scatter plots (so error bars can find them along with bars)
    var scattertraces = plotinfo.plot.selectAll('g.trace.scatter') // <-- select trace group
        .data(cdscatter);
    scattertraces.enter().append('g') // <-- add a trace for each calcdata
        .attr('class','trace scatter')
        .style('stroke-miterlimit',2);

    // BUILD LINES AND FILLS
    var prevpts='',tozero,tonext,nexttonext;
    scattertraces.each(function(d){ // <-- now, iterate through arrays of {x,y} objects
        var t=d[0].t; // <-- get trace-wide formatting object
        if(t.visible===false) { return; }
        var i=-1,tr=d3.select(this);
        // make the fill-to-zero path now, so it shows behind the line
        // have to break out of d3-style here (data-curve attribute) because fill to next
        // puts the fill associated with one trace grouped with the previous
        tozero = (t.fill.substr(0,6)=='tozero' || (t.fill.substr(0,2)=='to' && !prevpts)) ?
            tr.append('path').classed('js-fill',true).attr('data-curve',t.cdcurve) : null;
        // make the fill-to-next path now for the NEXT trace, so it shows behind both lines
        // nexttonext was created last time, but give it this curve's data for fill color
        if(nexttonext) { tonext = nexttonext.datum(d); }
        // now make a new nexttonext for next time
        nexttonext = tr.append('path').classed('js-fill',true);
        var pt0=null, pt1=null;
        // pts is the current path we're building... it has the form "x,yLx,y...Lx,y"
        // and later we add the first letter, either "M" if this is the beginning of
        // the path, or "L" if it's being concatenated on something else
        // pts ends at a missing point, and gets restarted at the next point (unless t.connectgaps is truthy)
        // pts2 is all paths for this curve, joined together straight across gaps
        var pts = '', pts2 = '', atLeastTwo;

        // for decimation: store pixel positions of things we're working with as [x,y]
        var lastEntered, tryHigh, tryLow, prevPt, pti;
        // lastEnd: high or low, which is most recent?
        // decimationMode: -1 (not decimating), 0 (x), 1 (y)
        // decimationTolerance: max pixels between points to allow decimation
        var lastEnd, decimationMode, decimationTolerance;

        // add a single [x,y] to the pts string
        function addPt(pt) {
            atLeastTwo = true;
            add0(pt); // implicit array stringifying
            pt1 = pt;
        }

        // simpler version where we don't need the extra assignments
        // but I made this a function so in principle we can do more than just lines in the
        // future, like smoothing splines.
        function add0(pt) { pts += 'L' + pt; }

        // finish one decimation step - now decide what to do with tryHigh, tryLow, and prevPt
        // (prevPt is the last one before the decimation ended)
        function finishDecimation(pt) {
            if(pt) { prevPt = pt; }
            if(prevPt==tryHigh) {
                // ended this decimation on the high point, so add the low first (unless there was only one point)
                if(tryHigh!=tryLow) { add0(tryLow); }
            }
            else if(prevPt==tryLow || tryLow==tryHigh) {
                // ended on the low point (or high and low are same), so add high first
                add0(tryHigh);
            }
            else if(lastEnd=='high') { add0(tryLow+'L'+tryHigh); } // low, then high, then prev
            else { add0(tryHigh+'L'+tryLow); } // high, low, prev
            // lastly, add the endpoint of this decimation
            addPt(prevPt);
            // reset status vars
            lastEntered = prevPt;
            tryHigh = tryLow = null;
            decimationMode = -1;
        }

        while(i<d.length) {
            pts='';
            atLeastTwo = false;
            lastEntered = null;
            decimationMode = -1;
            for(i++; i<d.length; i++) {
                pti = [xa.c2p(d[i].x), ya.c2p(d[i].y)];
                if(!$.isNumeric(pti[0])||!$.isNumeric(pti[1])) { // TODO: smart lines going off the edge?
                    if(t.connectgaps) { continue; }
                    else { break; }
                }

                // DECIMATION
                // first point: always add it, and prep the other variables
                if(!lastEntered) {
                    lastEntered = pti;
                    pts += lastEntered;
                    if(!pt0) { pt0 = lastEntered; }
                    continue;
                }

                // figure out the decimation tolerance - on-plot has one value, then it increases as you
                // get farther off-plot. the value is in pixels, and is based on the line width, which
                // means we need to replot if we change the line width
                decimationTolerance = (0.75 + 10*Math.max(0,
                    Math.max(-pti[0],pti[0]-xa._length)/xa._length,
                    Math.max(-pti[1],pti[1]-ya._length)/ya._length)) * Math.max(t.lw||1, 1);
                // if the last move was too much for decimation, see if we're starting a new decimation block
                if(decimationMode<0) {
                    // first look for very near x values (decimationMode=0), then near y values (decimationMode=1)
                    if(Math.abs(pti[0]-lastEntered[0]) < decimationTolerance) { decimationMode = 0; }
                    else if(Math.abs(pti[0]-lastEntered[1]) < decimationTolerance) { decimationMode = 1; }
                    else { // no decimation here - add this point and move on
                        lastEntered = pti;
                        addPt(lastEntered);
                        continue;
                    }
                }
                else if(Math.abs(pti[decimationMode] - lastEntered[decimationMode]) >= decimationTolerance) {
                    // we were decimating, now we're done
                    finishDecimation(pti);
                    continue;
                }
                // OK, we're collecting points for decimation, for realz now.
                prevPt = pti;
                if(!tryHigh || prevPt[1-decimationMode]>tryHigh[1-decimationMode]) {
                    tryHigh = prevPt;
                    lastEnd = 'high';
                }
                if(!tryLow || prevPt[1-decimationMode]<tryLow[1-decimationMode]) {
                    tryLow = prevPt;
                    lastEnd = 'low';
                }
            }
            if(decimationMode>=0) { // end of the data is mid-decimation - close it out.
                finishDecimation(pti);
            }
            if(pts) {
                pts2+=(pts2 ? 'L' : '') + pts;
                if(t.mode.indexOf('lines')!=-1 && atLeastTwo) {
                    tr.append('path').classed('js-line',true).attr('d','M'+pts);
                }
            }
        }
        if(pts2) {
            if(tozero) {
                if(t.fill.charAt(t.fill.length-1)=='y') { pt0[1]=pt1[1]=ya.c2p(0,true); }
                else { pt0[0]=pt1[0]=xa.c2p(0,true); }
                tozero.attr('d','M'+pts2+'L'+pt1+'L'+pt0+'Z');
            }
            else if(t.fill.substr(0,6)=='tonext' && pts2 && prevpts) {
                tonext.attr('d','M'+pts2.split('L').reverse().join('L')+'L'+prevpts+'Z');
            }
            prevpts = pts2;
        }
    });

    // remove paths that didn't get used
    scattertraces.selectAll('path:not([d])').remove();

    // BUILD SCATTER POINTS
    scattertraces.append('g')
        .attr('class','points')
        .each(function(d){
            var t = d[0].t,
                s = d3.select(this),
                showMarkers = t.mode.indexOf('markers')!=-1,
                showText = t.mode.indexOf('text')!=-1;
            if((!showMarkers && !showText) || t.visible===false) { s.remove(); }
            else {
                if(showMarkers) {
                    s.selectAll('path')
                        .data(Plotly.Lib.identity)
                        .enter().append('path')
                        .call(Plotly.Drawing.translatePoints,xa,ya);
                }
                if(showText) {
                    s.selectAll('text')
                        .data(Plotly.Lib.identity)
                        .enter().append('text')
                        .call(Plotly.Drawing.translatePoints,xa,ya);
                }
            }
        });
};

}()); // end Scatter object definition