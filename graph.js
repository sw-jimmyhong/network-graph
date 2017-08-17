    var width = 1000,
        height = 800,
        margin = 20,
        dr = 10,      // default point radius
        max = 50,   // max radius
        off = 15,    // cluster hull offset
        expand = [],
        // expand = {1: true, 2: true, 3:true}, // expanded clusters
        simulation, root, data, link, node, label, nest, net, force, hullg, hull, linkg, nodeg, scale;

    var mode = "group";

    var svg = d3.select("#graph").append("svg");
    svg.attr("width", width)
        .attr("height", height);

    var zoom = d3.zoom()
        .scaleExtent([0.5, 50])
        .on("zoom", zoomed);

    var g = svg.call(zoom)
        .append("g")
        .attr("transform", "translate(40,0)");

    var color = d3.scaleOrdinal(d3.schemeCategory20);
    var curve = d3.line()
        .curve(d3.curveCardinalClosed.tension(0.5));

    var pack = d3.pack()
        .size([dr, dr])
        .padding(2);

    // d3.select("#reset").on("click", function () {
    //     console.log("reset");
    //     zoom.transform(g, d3.zoomIdentity.scale(1));
    // }}

    function nodeid(n) {
        return n.size ? "_g_" + n.group : n.name;
    }

    function linkid(l) {
        var u = nodeid(l.source),
            v = nodeid(l.target);
        return u < v ? u + "|" + v : v + "|" + u;
    }

    function getGroup(n) {
        return n.group;
    }

    function drawCluster(d) {
        // console.log(d);
        return curve(d.path); // 0.8
    }
    function convexHulls(nodes, index, offset) {
        var hulls = {};

        // create point sets
        for (var k = 0; k < nodes.length; ++k) {
            var n = nodes[k];
            if (n.size) continue;
            var i = index(n),
                l = hulls[i] || (hulls[i] = []);
            l.push([n.x - offset, n.y - offset]);
            l.push([n.x - offset, n.y + offset]);
            l.push([n.x + offset, n.y - offset]);
            l.push([n.x + offset, n.y + offset]);
        }
        // create convex hulls
        var hullset = [];
        for (i in hulls) {
            hullset.push({ group: i, path: d3.polygonHull(hulls[i]) });
        }
        return hullset;
    }

    // constructs the network to visualize
    function network(data, prev, index, expand) {
        expand = expand || {};
        var gm = {},    // group map
            nm = {},    // node map
            lm = {},    // link map
            gn = {},    // previous group nodes
            gc = {},    // previous group centroids
            nodes = [], // output nodes
            links = []; // output links

        // process previous nodes for reuse or centroid calculation
        if (prev) {
            prev.nodes.forEach(function (n) {
                var i = index(n), o;
                if (n.size > 0) {
                    gn[i] = n;
                    n.size = 0;
                } else {
                    o = gc[i] || (gc[i] = { x: 0, y: 0, count: 0 });
                    o.x += n.x;
                    o.y += n.y;
                    o.count += 1;
                }
            });
        }

        // determine nodes
        for (var k = 0; k < data.nodes.length; ++k) {
            var n = data.nodes[k],
                i = index(n),
                l = gm[i] || (gm[i] = gn[i]) || (gm[i] = { group: i, size: 0, nodes: [] });

            if (expand[i]) {
                // the node should be directly visible
                nm[n.name] = nodes.length;
                nodes.push(n);
                if (gn[i]) {
                    // place new nodes at cluster location (plus jitter)
                    n.x = gn[i].x + Math.random();
                    n.y = gn[i].y + Math.random();
                }
            } else {
                // the node is part of a collapsed cluster
                if (l.size == 0) {
                    // if new cluster, add to set and position at centroid of leaf nodes
                    nm[i] = nodes.length;
                    nodes.push(l);
                    if (gc[i]) {
                        l.x = gc[i].x / gc[i].count;
                        l.y = gc[i].y / gc[i].count;
                    }
                }
                l.nodes.push(n);
            }
            // always count group size as we also use it to tweak the force graph strengths/distances
            l.size += 1;
            n.group_data = l;
        }

        for (i in gm) { gm[i].link_count = 0; }

        // determine links
        for (k = 0; k < data.links.length; ++k) {
            var e = data.links[k],
                u = index(e.source),
                v = index(e.target);
            if (u != v) {
                gm[u].link_count++;
                gm[v].link_count++;
            }
            u = expand[u] ? nm[e.source.name] : nm[u];
            v = expand[v] ? nm[e.target.name] : nm[v];
            var i = (u < v ? u + "|" + v : v + "|" + u),
                l = lm[i] || (lm[i] = { source: u, target: v, size: 0 });
            l.size += 1;
        }
        for (i in lm) { links.push(lm[i]); }

        // circle packing
        for (i in nodes) {
            var inner = nodes[i].nodes;
            for (j in inner) {
                var root = d3.hierarchy(inner[j], function (d) { return d.children; })
                    .sum(function (d) { return d.size })
                    .sort(function (a, b) { return b.value - a.value; });
                var packed = pack(root);
                if (packed.r) {
                    inner[j] = packed;
                }
            }
        }
        
        return { nodes: nodes, links: links };
    }

    function init() {
        d3.json("data.json", function (error, graph) {
            if (error) throw error;
            data = graph;

            for (var i = 0; i < data.links.length; ++i) {
                o = data.links[i];
                o.source = data.nodes[o.source];
                o.target = data.nodes[o.target];
            }

            hullg = g.append("g");
            linkg = g.append("g");
            nodeg = g.append("g");
            packg = g.append("g");
            update();
        });
    }

    function update() {
        net = network(data, net, getGroup, expand);

        console.log(net.nodes);

        simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id((d, i) => d.index).distance(function (l, i) {
                var n1 = l.source, n2 = l.target;
                return 50 +
                    Math.min(20 * Math.min((n1.size || (n1.group != n2.group ? n1.group_data.size : 0)),
                        (n2.size || (n1.group != n2.group ? n2.group_data.size : 0))),
                        -30 +
                        30 * Math.min((n1.link_count || (n1.group != n2.group ? n1.group_data.link_count : 0)),
                            (n2.link_count || (n1.group != n2.group ? n2.group_data.link_count : 0))),
                        100);
            }).strength(0.5))
            .force("charge", d3.forceManyBody().strength(-600))
            .force("gravity", d3.forceManyBody())
            .force("center", d3.forceCenter(width / 2, height / 2));

        // initiate force simulation
        simulation.nodes(net.nodes);
        simulation.force("link")
            .links(net.links);
        simulation.on("tick", ticked);

        // draw hulls
        hullg.selectAll("path.hull").remove();
        hull = hullg.selectAll("path.hull")
            .data(convexHulls(net.nodes, getGroup, off))
            .enter().append("path")
            .attr("class", "hull")
            .attr("d", drawCluster)
            .style("fill", function (d) { return color(d.group); })
            .on("click", function (d) {
                // console.log("hull click", d, arguments, this, expand[d.group]);
                expand[d.group] = false; update();
            });
        // hull = convexHulls(net.nodes, getGroup, off);

        // draw links
        link = linkg.selectAll("line.links").data(net.links, linkid);
        link.exit().remove();
        var linkEnter = link.enter()
            .append("line")
            .attr("class", "links")
            .attr("x1", function (d) { return d.source.x; })
            .attr("y1", function (d) { return d.source.y; })
            .attr("x2", function (d) { return d.target.x; })
            .attr("y2", function (d) { return d.target.y; })
            .style("stroke", "#aaa")
            .style("stroke-width", function (d) { return d.size || 1; });
        link = linkEnter.merge(link);

        // draw nodes
        node = nodeg.selectAll("circle.node").data(net.nodes, nodeid);
        node.exit().remove();
        var nodeEnter = node.enter()
            .append("circle")
            .attr("class", function (d) {
                return "node" + (d.size ? "" : " leaf");
            })
            .attr("r", dr)
            // .attr("r", function (d) { return d.size ? d.size + dr : dr + 1; })
            .attr("cx", function (d) { return d.x; })
            .attr("cy", function (d) { return d.y; })
            .style("fill", function (d) { return color(d.group); })
            .on("click", function (d) {
                // console.log("node click", d, arguments, this, expand[d.group]);
                expand[d.group] = !expand[d.group];
                update();
            })
            .style("cursor", "pointer")
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));
        node = nodeEnter.merge(node);
        simulation.restart();
    }

    function ticked() {
        if (!hull.empty()) {
            hull.data(convexHulls(net.nodes, getGroup, off))
                .attr("d", drawCluster);
        }

        link
            .attr("x1", function (d) { return d.source.x; })
            .attr("y1", function (d) { return d.source.y; })
            .attr("x2", function (d) { return d.target.x; })
            .attr("y2", function (d) { return d.target.y; });

        node.attr("cx", function (d) { return d.x; })
            .attr("cy", function (d) { return d.y; });
    }

    function dragstarted(d) {
        if (!d3.event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(d) {
        // bounded drag
        var dx = d3.event.x;
        var dy = d3.event.y;
        if (dx > width) {
            d.fx = width;
        } else if (dx < 0) {
            d.fx = 0;
        }
        else {
            d.fx = d3.event.x;
        }
        if (dy > height) {
            d.fy = height;
        } else if (dy < 0) {
            d.fy = 0;
        }
        else {
            d.fy = d3.event.y;
        }
    }

    function dragended(d) {
        if (!d3.event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    function zoomed() {
        g.attr("transform", d3.event.transform);
        var transform = d3.zoomTransform(this);
        scale = transform.k;
        var circle = d3.selectAll("circle.node");
        var line = d3.selectAll("line.links");
        var radius = dr;
        if (dr * scale > max) {
            radius = max / Math.sqrt(scale);
        } else {
            radius = dr * Math.sqrt(scale);
        }
        circle.attr("r", radius);
        circle.style("stroke-width", 3 / Math.sqrt(scale));
        line.style("stroke-width", function (d) {
            return d.size / Math.sqrt(scale)
        });
    }

    init();