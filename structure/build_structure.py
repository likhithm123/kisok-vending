#!/usr/bin/env python3
"""
CampusVend cabinet — single source of truth for the 3D layout.
Run:  python3 build_structure.py
Writes (next to this file):
  cabinet.scad        parametric-style OpenSCAD model (open in OpenSCAD, export STEP/DXF via FreeCAD if needed)
  cabinet.stl         same geometry as a mesh — opens in any CAD / 3D viewer / slicer
  viewer.html         interactive 3D view in a browser (drag to rotate, scroll to zoom)
  elevations.svg      dimensioned front and side elevations
All dimensions are millimetres. X = width (left to right), Y = depth (0 = front face), Z = height from floor.
"""
import json
import struct
from pathlib import Path

W, D, H = 1050, 820, 1900
TRAYS, COLS = 6, 8
TRAY_Z0, TRAY_PITCH = 680, 190

# colour, group
STEEL, DARK, INSUL, TRAY, GLASS, ELEC, ACCENT, LED = "#9aa3ab", "#3d464d", "#c9d2d8", "#e9ecef", "#7fd4e6", "#2e8b57", "#0f766e", "#ffe680"
parts = []


def box(name, x, y, z, w, d, h, color, group, note=""):
    parts.append(dict(name=name, x=x, y=y, z=z, w=w, d=d, h=h, color=color, group=group, note=note))


# ---- body ----
box("Plinth + 4 levelling feet", 0, 0, 0, W, D, 100, DARK, "body", "3 mm MS channel frame, M12 levelling feet, floor-anchor holes")
box("Cooling deck bay", 0, 60, 100, W, 760, 280, DARK, "body", "slide-out refrigeration deck, louvred front kick panel + rear exhaust")
box("Compartment floor (insulated)", 0, 60, 380, 760, 760, 40, INSUL, "body", "40 mm PUF sandwich, cold-air inlet slot at rear")
box("Left side panel (insulated)", 0, 60, 420, 40, 760, 1440, INSUL, "body", "40 mm PUF sandwich, 1.2 mm CRCA skins")
box("Back panel (insulated)", 40, 780, 420, 970, 40, 1440, INSUL, "body")
box("Right side panel", 1010, 60, 420, 40, 760, 1440, STEEL, "body", "1.5 mm CRCA, ventilation louvres top + bottom for electronics bay")
box("Top panel (insulated)", 0, 60, 1860, W, 760, 40, INSUL, "body")
box("Divider wall (insulated)", 720, 60, 420, 40, 720, 1440, INSUL, "body", "separates cold product space from warm electronics bay; sealed cable gland")

# ---- product compartment ----
box("Pickup bin / delivery chute", 60, 70, 430, 640, 300, 170, STEEL, "inside", "1.2 mm SS 304, padded floor, anti-reach baffle")
box("Drop sensor (IR light curtain)", 45, 80, 615, 670, 25, 20, ACCENT, "inside", "emitter left, receiver right, across the full drop shaft")
for i in range(TRAYS):
    z = TRAY_Z0 + i * TRAY_PITCH
    row = "ABCDEF"[TRAYS - 1 - i]  # tray A is the top tray
    box(f"Tray {row} ({COLS} spirals)", 50, 220, z, 660, 540, 25, TRAY, "inside", "pull-out on telescopic slides, tilts 15 deg for loading")
    box(f"Tray {row} motor rail ({COLS} x 24 V spiral motors)", 50, 720, z + 25, 660, 40, 60, DARK, "inside")
    for j in range(COLS + 1):
        box(f"Tray {row} divider {j + 1}", 50 + j * 82 - (2 if j else 0), 220, z + 25, 4, 500, 55, STEEL, "inside")
box("LED strip left", 44, 62, 640, 8, 8, 1200, LED, "inside", "24 V cool-white, in aluminium channel")
box("LED strip right", 708, 62, 640, 8, 8, 1200, LED, "inside")
box("Temperature sensor DS18B20", 60, 760, 1500, 15, 15, 40, ACCENT, "inside", "mid-height on back wall, away from cold-air outlet")

# ---- electronics bay (right column, behind the control fascia) ----
box("Electronics mounting plate", 770, 700, 500, 230, 5, 1300, STEEL, "electronics", "2 mm galvanised, DIN rails")
box("Mains panel: MCB + RCBO + surge protector", 780, 600, 1600, 210, 100, 150, ELEC, "electronics")
box("24 V 10 A power supply", 780, 590, 1360, 115, 110, 215, ELEC, "electronics")
box("5 V 5 A power supply (Pi) + 12 V buck (screen)", 905, 620, 1400, 85, 80, 160, ELEC, "electronics")
box("Raspberry Pi 5 in DIN case", 780, 640, 1220, 100, 60, 110, ELEC, "electronics")
box("Arduino Mega 2560 + screw-terminal shield", 890, 650, 1220, 110, 50, 110, ELEC, "electronics")
box("Relay board 1 (rows)", 780, 670, 1060, 140, 30, 130, ELEC, "electronics")
box("Relay board 2 (columns)", 780, 670, 910, 140, 30, 130, ELEC, "electronics")
box("Relay board 3 (lights, lock, cooling)", 930, 670, 1060, 70, 30, 80, ELEC, "electronics")
box("Terminal blocks + fuse holders", 780, 670, 780, 210, 30, 100, ELEC, "electronics")
box("Network: RJ45 bulkhead + Wi-Fi antenna", 960, 760, 1780, 40, 20, 60, ACCENT, "electronics", "antenna outside the steel shell, top rear")

# ---- door (hinged on the left, full height above the kick panel) ----
box("Door left stile (hinge side)", 0, 0, 380, 50, 55, 1520, DARK, "door", "3 concealed hinges, 2 mm CRCA door skin")
box("Door top rail", 50, 0, 1840, 660, 55, 60, DARK, "door")
box("Display window (double-glazed toughened glass)", 50, 10, 640, 660, 24, 1200, GLASS, "door", "6 mm + 12 mm argon gap + 6 mm, anti-fog heater film")
box("Door lower panel", 50, 0, 380, 660, 55, 260, DARK, "door")
box("Pickup flap (push-in, anti-theft)", 110, -4, 440, 540, 8, 160, STEEL, "door", "540 x 160 opening, sprung flap")
box("Door mullion", 710, 0, 380, 60, 55, 1520, DARK, "door")
box("Control fascia", 770, 0, 380, 280, 55, 1520, DARK, "door", "2 mm CRCA, cut-outs for screen, card terminal, speaker")
box('Touchscreen 15.6" portrait', 795, -6, 1050, 230, 10, 380, "#111827", "door", "cut-out 198 x 348 visible, VESA 75/100 rear mount, 4 mm toughened cover glass")
box("Card terminal (bank EDC) bay", 850, -6, 800, 120, 10, 190, "#1f2937", "door", "anti-pull bracket, tilt 15 deg, USB-C power")
box("Speaker grille", 860, -3, 1480, 100, 5, 60, STEEL, "door")
box("Door lock (solenoid, 24 V) + key override", 1000, 20, 1000, 40, 40, 120, ACCENT, "door", "3-point latch driven by solenoid; mechanical key for power failure")
box("Door switch (reed)", 1000, 50, 1700, 30, 15, 40, ACCENT, "door")

here = Path(__file__).parent

# ---------- OpenSCAD ----------
scad = [f"// CampusVend cabinet {W} x {D} x {H} mm — generated by build_structure.py", "show_door = true; show_inside = true; show_electronics = true;", ""]
for p in parts:
    cond = {"door": "if (show_door) ", "inside": "if (show_inside) ", "electronics": "if (show_electronics) "}.get(p["group"], "")
    alpha = 0.35 if p["color"] == GLASS else 1
    scad.append(f'{cond}color("{p["color"]}", {alpha}) translate([{p["x"]}, {p["y"]}, {p["z"]}]) cube([{p["w"]}, {p["d"]}, {p["h"]}]); // {p["name"]}')
(here / "cabinet.scad").write_text("\n".join(scad) + "\n")

# ---------- binary STL ----------
tris = []
for p in parts:
    x0, y0, z0, x1, y1, z1 = p["x"], p["y"], p["z"], p["x"] + p["w"], p["y"] + p["d"], p["z"] + p["h"]
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    for a, b, c, n in [(0, 2, 1, (0, 0, -1)), (0, 3, 2, (0, 0, -1)), (4, 5, 6, (0, 0, 1)), (4, 6, 7, (0, 0, 1)), (0, 1, 5, (0, -1, 0)), (0, 5, 4, (0, -1, 0)),
                       (2, 3, 7, (0, 1, 0)), (2, 7, 6, (0, 1, 0)), (1, 2, 6, (1, 0, 0)), (1, 6, 5, (1, 0, 0)), (3, 0, 4, (-1, 0, 0)), (3, 4, 7, (-1, 0, 0))]:
        tris.append((n, v[a], v[b], v[c]))
with open(here / "cabinet.stl", "wb") as f:
    f.write(b"CampusVend cabinet (mm)".ljust(80, b" "))
    f.write(struct.pack("<I", len(tris)))
    for n, a, b, c in tris:
        f.write(struct.pack("<12fH", *n, *a, *b, *c, 0))

# ---------- elevations SVG ----------
S, M = 0.3, 70


def view(ox, title, hx, wx, total_w):
    out = [f'<text x="{ox}" y="30" font-size="16" font-weight="700">{title}</text>']
    for p in parts:
        if p["name"].startswith("Tray") and "divider" in p["name"]:
            continue
        x, w = p[hx], p[wx]
        out.append(f'<rect x="{ox + x * S:.1f}" y="{M + (H - p["z"] - p["h"]) * S:.1f}" width="{w * S:.1f}" height="{p["h"] * S:.1f}" fill="{p["color"]}" fill-opacity="0.18" stroke="#333" stroke-width="0.7"><title>{p["name"]}</title></rect>')
    y = M + H * S + 28
    out.append(f'<line x1="{ox}" x2="{ox + total_w * S}" y1="{y}" y2="{y}" stroke="#c00"/><text x="{ox + total_w * S / 2}" y="{y + 16}" text-anchor="middle" font-size="13" fill="#c00">{total_w} mm</text>')
    return out


svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {int(2 * M + (W + D) * S + 160)} {int(M + H * S + 70)}" font-family="Arial" style="background:#fff">']
svg += view(M, "FRONT ELEVATION", "x", "w", W)
side_x = M + W * S + 130
svg += view(side_x, "SIDE ELEVATION (front on the left)", "y", "d", D)
hx = M + W * S + 30
svg.append(f'<line x1="{hx}" x2="{hx}" y1="{M}" y2="{M + H * S}" stroke="#c00"/><text x="{hx + 8}" y="{M + H * S / 2}" font-size="13" fill="#c00">{H} mm</text>')
for z, label in [(100, "plinth 100"), (380, "door starts 380"), (440, "pickup flap 440-600"), (640, "window 640-1840"), (1050, "screen 1050-1430")]:
    yy = M + (H - z) * S
    svg.append(f'<line x1="{M - 8}" x2="{M}" y1="{yy}" y2="{yy}" stroke="#c00"/><text x="{M - 10}" y="{yy + 4}" font-size="9" text-anchor="end" fill="#c00">{z}</text>')
svg.append("</svg>")
(here / "elevations.svg").write_text("\n".join(svg))

# ---------- interactive viewer ----------
html = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CampusVend cabinet — 3D layout</title>
<style>body{margin:0;font:14px system-ui,sans-serif;background:#eef1f4;color:#111;display:grid;grid-template-columns:1fr 340px;height:100vh}
#c{min-width:0;position:relative}canvas{display:block}aside{background:#fff;border-left:1px solid #d5d9de;overflow:auto;padding:14px}
h1{font-size:17px;margin:0 0 4px}label{display:block;margin:4px 0}table{border-collapse:collapse;width:100%;font-size:12px;margin-top:10px}
td{border-bottom:1px solid #e5e7eb;padding:4px 3px;vertical-align:top}tr:hover{background:#eefaf8}.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
#hint{position:absolute;left:12px;bottom:10px;color:#555}@media(max-width:800px){body{grid-template-columns:1fr;grid-template-rows:60vh auto}}</style></head>
<body><div id="c"><div id="hint">Drag to rotate · scroll to zoom · needs internet once to load three.js</div></div>
<aside><h1>CampusVend cabinet</h1><div>__W__ × __D__ × __H__ mm (W × D × H)</div>
<label><input type="checkbox" data-g="door" checked> Door, glass, screen</label><label><input type="checkbox" data-g="inside" checked> Trays, chute, sensors</label>
<label><input type="checkbox" data-g="electronics" checked> Electronics bay</label><label><input type="checkbox" data-g="body" checked> Body panels</label>
<table id="t"></table></aside>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
const P=__PARTS__,W=__W__,D=__D__,H=__H__,el=document.getElementById('c');
const scene=new THREE.Scene();scene.background=new THREE.Color(0xeef1f4);
const cam=new THREE.PerspectiveCamera(40,1,10,20000),r=new THREE.WebGLRenderer({antialias:true});el.appendChild(r.domElement);
scene.add(new THREE.AmbientLight(0xffffff,.7));const dl=new THREE.DirectionalLight(0xffffff,.6);dl.position.set(1500,3000,2500);scene.add(dl);
const groups={};
for(const p of P){const glass=p.color==='#7fd4e6';
  const m=new THREE.Mesh(new THREE.BoxGeometry(p.w,p.h,p.d),new THREE.MeshLambertMaterial({color:p.color,transparent:glass||p.group==='body',opacity:glass?.3:p.group==='body'?.55:1}));
  m.position.set(p.x+p.w/2-W/2,p.z+p.h/2,D/2-(p.y+p.d/2));
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),new THREE.LineBasicMaterial({color:0x222222,transparent:true,opacity:.35})));
  (groups[p.group]??=new THREE.Group()).add(m);}
for(const g of Object.values(groups))scene.add(g);
const grid=new THREE.GridHelper(4000,20,0xbbbbbb,0xdddddd);scene.add(grid);
let az=.6,elv=.25,dist=4200,drag=null;
function place(){cam.position.set(dist*Math.sin(az)*Math.cos(elv),H/2+dist*Math.sin(elv),dist*Math.cos(az)*Math.cos(elv));cam.lookAt(0,H/2,0);r.render(scene,cam);}
function size(){r.setSize(el.clientWidth,el.clientHeight);cam.aspect=el.clientWidth/el.clientHeight;cam.updateProjectionMatrix();place();}
el.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];el.setPointerCapture(e.pointerId)});
el.addEventListener('pointermove',e=>{if(!drag)return;az-=(e.clientX-drag[0])*.008;elv=Math.max(-.2,Math.min(1.4,elv+(e.clientY-drag[1])*.006));drag=[e.clientX,e.clientY];place()});
el.addEventListener('pointerup',()=>drag=null);
el.addEventListener('wheel',e=>{e.preventDefault();dist=Math.max(1500,Math.min(9000,dist+e.deltaY*2));place()},{passive:false});
addEventListener('resize',size);
for(const c of document.querySelectorAll('[data-g]'))c.onchange=()=>{groups[c.dataset.g].visible=c.checked;place()};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
document.getElementById('t').innerHTML=P.filter(p=>!/divider/.test(p.name)).map(p=>`<tr><td><span class="sw" style="background:${p.color}"></span></td><td><b>${esc(p.name)}</b><br>${p.w} × ${p.d} × ${p.h} mm${p.note?'<br>'+esc(p.note):''}</td></tr>`).join('');
size();
</script></body></html>"""
html = html.replace("__PARTS__", json.dumps(parts)).replace("__W__", str(W)).replace("__D__", str(D)).replace("__H__", str(H))
(here / "viewer.html").write_text(html)
print(f"{len(parts)} parts -> cabinet.scad, cabinet.stl ({len(tris)} triangles), viewer.html, elevations.svg")
