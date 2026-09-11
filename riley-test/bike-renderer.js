/* Original code-drawn studio BMX. Editable SVG materials, without external assets. */
const JKCrewBikeArt = (() => {
  "use strict";
  const defaults = Object.fromEntries(["frame", "fork", "bars", "grips", "rims", "hubs", "seat", "pedals", "cranks", "sprocket"].map(part => [part, "#F1F4F8"]));
  const names = { frame: "Frame", fork: "Fork", bars: "Handlebars", grips: "Grips", rims: "Wheel rims", hubs: "Wheel hubs", seat: "Seat", pedals: "Pedals", cranks: "Cranks", sprocket: "Sprocket", tyres: "Tyres", pegs: "Pegs", decal: "Frame decal" };
  const shade = (hex, amount) => {
    const target = amount < 0 ? 0 : 255, strength = Math.abs(amount);
    return "#" + [1, 3, 5].map(offset => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * (1 - strength) + target * strength).toString(16).padStart(2, "0")).join("");
  };
  const choice = (value, options, fallback) => options.includes(value) ? value : fallback;
  const n = value => Number(value.toFixed(2));
  const point = (x, y, rx, ry, angle) => `${n(x + Math.cos(angle) * rx)},${n(y + Math.sin(angle) * ry)}`;

  function render(config = {}, { idPrefix = "bike", selectedPart = "", interactive = false } = {}) {
    config = config && typeof config === "object" ? config : {};
    const colors = Object.fromEntries(Object.entries(defaults).map(([part, fallback]) => [part, typeof config.colors?.[part] === "string" && /^#[0-9a-f]{6}$/i.test(config.colors[part]) ? config.colors[part].toUpperCase() : fallback]));
    const barStyle = choice(config.barStyle, ["two-piece", "four-piece"], "two-piece");
    const tyreStyle = choice(config.tyreStyle, ["white", "black", "tan-wall", "white-wall"], "white");
    const seatStyle = choice(config.seatStyle, ["slim", "padded"], "slim");
    const pegs = choice(config.pegs, ["none", "rear", "both"], "none");
    const decal = choice(config.decal, ["jkcrew", "lightning", "none"], "none");
    const prefix = "bmx-" + (String(idPrefix || "bike").replace(/[^a-z0-9_-]/gi, "-").slice(0, 64) || "bike");
    const id = name => `${prefix}-${name}`;
    const paint = part => `url(#${id(part)})`;
    const selected = Object.hasOwn(names, selectedPart) ? selectedPart : "";
    const hit = (shape, attrs, width = 24) => interactive ? `<${shape} ${attrs} fill="none" stroke="transparent" stroke-width="${width}" pointer-events="stroke"/>` : "";
    const group = (part, content, hitArea = "") => `<g${interactive ? ` data-bike-part="${part}" role="button" tabindex="0" aria-label="Customize ${names[part].toLowerCase()}" style="cursor:pointer"` : ""}${selected === part ? ` filter="url(#${id("selected")})"` : ""}><title>${names[part]}</title>${hitArea}${content}</g>`;
    const tubeGradients = [];
    // Each round tube gets a perpendicular material gradient, keeping highlights
    // consistent on the top tube, diagonal frame, and swept handlebars.
    const tube = (d, part, width, axis, depth = false) => {
      const color = colors[part], [x1, y1, x2, y2] = axis;
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = -(y2 - y1) / length * width / 2, ny = (x2 - x1) / length * width / 2;
      const gradientId = id(`tube-${tubeGradients.length}`);
      tubeGradients.push(`<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="${n(x1 + nx)}" y1="${n(y1 + ny)}" x2="${n(x1 - nx)}" y2="${n(y1 - ny)}"><stop stop-color="${shade(color, depth ? -.32 : -.27)}"/><stop offset=".2" stop-color="${shade(color, depth ? -.12 : -.07)}"/><stop offset=".57" stop-color="${shade(color, depth ? -.03 : .34)}"/><stop offset=".8" stop-color="${shade(color, depth ? -.08 : .12)}"/><stop offset="1" stop-color="${shade(color, -.17)}"/></linearGradient>`);
      return `<path d="${d}" fill="none" stroke="${shade(color, -.33)}" stroke-width="${width + .9}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="url(#${gradientId})" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    };
    // The rear wheel sits a little higher and farther away. Offset tyre shoulders
    // and hub flanges give this shallow drive-side perspective visible depth.
    const wheels = [{ x: 240, y: 365, rx: 101, ry: 110, depth: 7 }, { x: 671, y: 378, rx: 109, ry: 118, depth: 10 }];
    const whiteTyre = tyreStyle === "white", rubber = whiteTyre ? "#EEF0F3" : "#242A2E";
    const tyres = wheels.map(w => {
      const p = (rx, ry, angle) => point(w.x, w.y, rx, ry, angle);
      const tread = Array.from({ length: 72 }, (_, i) => {
        const a = i * Math.PI / 36;
        return `<path d="M${p(w.rx + 7.2, w.ry + 7.2, a)} L${p(w.rx + 10, w.ry + 10, a + .025)} L${p(w.rx + 12, w.ry + 12, a + .011)} M${p(w.rx + 4.4, w.ry + 4.4, a + .024)} L${p(w.rx + 6.4, w.ry + 6.4, a + .049)}" fill="none" stroke="${whiteTyre ? "#BAC2C9" : "#60696D"}" stroke-width=".65" opacity="${whiteTyre ? ".48" : ".42"}" stroke-linejoin="round"/>`;
      }).join("");
      const wall = tyreStyle === "tan-wall" ? "#D1B389" : "#E5E8E2";
      return `<ellipse cx="${w.x - w.depth}" cy="${w.y - 3}" rx="${w.rx}" ry="${w.ry}" fill="none" stroke="${shade(rubber, whiteTyre ? -.19 : -.35)}" stroke-width="23"/>
        <ellipse cx="${w.x - w.depth * .45}" cy="${w.y - 1.5}" rx="${w.rx + .5}" ry="${w.ry + .5}" fill="none" stroke="url(#${id("tyre-shoulder")})" stroke-width="23"/>
        <ellipse cx="${w.x}" cy="${w.y}" rx="${w.rx}" ry="${w.ry}" fill="none" stroke="url(#${id("rubber")})" stroke-width="22"/>
        <ellipse cx="${w.x}" cy="${w.y}" rx="${w.rx + 10.9}" ry="${w.ry + 10.9}" fill="none" stroke="${whiteTyre ? "#C7CED5" : "#616A6F"}" stroke-opacity=".58" stroke-width=".6"/>
        ${["tan-wall", "white-wall"].includes(tyreStyle) ? `<ellipse cx="${w.x}" cy="${w.y}" rx="${w.rx - 2}" ry="${w.ry - 2}" fill="none" stroke="${wall}" stroke-width="10"/><ellipse cx="${w.x}" cy="${w.y}" rx="${w.rx + 2.6}" ry="${w.ry + 2.6}" fill="none" stroke="${shade(wall, .55)}" stroke-width=".7"/>` : `<ellipse cx="${w.x}" cy="${w.y}" rx="${w.rx - 1}" ry="${w.ry - 1}" fill="none" stroke="${whiteTyre ? "#FFFFFF" : "#4B555A"}" stroke-opacity=".58" stroke-width="1.1"/>`}
        ${tread}<path d="M${p(w.rx + 4, w.ry + 4, -2.7)} A${w.rx + 4} ${w.ry + 4} 0 0 1 ${p(w.rx + 4, w.ry + 4, -1.05)}" fill="none" stroke="#FFFFFF" stroke-opacity="${whiteTyre ? ".68" : ".13"}" stroke-width="1.6"/>
        <text x="${w.x - 17}" y="${w.y - w.ry + 3}" fill="${whiteTyre ? "#ADB5B8" : "#899195"}" font-family="Arial,sans-serif" font-size="4.5" font-weight="600" letter-spacing=".65" opacity=".8">20 × 2.40</text>`;
    }).join("");
    const spokes = wheels.map(w => Array.from({ length: 36 }, (_, i) => {
      const angle = i * Math.PI / 18, near = i % 2 === 0;
      const start = point(w.x + (near ? 1 : -7), w.y + (near ? 0 : -4), 8.5, 10.5, angle + (near ? .88 : -.88));
      const end = point(w.x, w.y, w.rx - 15, w.ry - 15, angle);
      return `<path d="M${start} L${end}" stroke="${near ? "#89969E" : "#B1BBC0"}" stroke-opacity="${near ? ".66" : ".65"}" stroke-width="${near ? ".7" : ".55"}"/><path d="M${point(w.x, w.y, w.rx - 18, w.ry - 18, angle)} L${end}" stroke="#A4AFB6" stroke-width="1.4"/>`;
    }).join("")).join("");
    const rims = wheels.map(w => `<ellipse cx="${w.x - 3}" cy="${w.y - 1}" rx="${w.rx - 13}" ry="${w.ry - 13}" fill="none" stroke="${shade(colors.rims, -.31)}" stroke-width="8"/>
      <ellipse cx="${w.x}" cy="${w.y}" rx="${w.rx - 13}" ry="${w.ry - 13}" fill="none" stroke="${paint("rims")}" stroke-width="7"/>
      <ellipse cx="${w.x}" cy="${w.y}" rx="${w.rx - 16.6}" ry="${w.ry - 16.6}" fill="none" stroke="${shade(colors.rims, -.3)}" stroke-width=".75"/>
      <ellipse cx="${w.x}" cy="${w.y}" rx="${w.rx - 9.5}" ry="${w.ry - 9.5}" fill="none" stroke="${shade(colors.rims, .7)}" stroke-width=".9"/>
      <path d="M${w.x + 16} ${w.y + w.ry - 20} l-1 -6" stroke="#9BA7AE" stroke-width="2.1" stroke-linecap="round"/><path d="M${w.x + 16.4} ${w.y + w.ry - 21} l-.7 -4" stroke="#E9ECEE" stroke-width=".65"/>`).join("");
    const hubs = wheels.map(w => `<path d="M${w.x - 10} ${w.y - 9} L${w.x + 2} ${w.y - 7} V${w.y + 7} L${w.x - 10} ${w.y + 4}Z" fill="${paint("hubs")}" stroke="${shade(colors.hubs, -.24)}" stroke-width=".8"/>
      <ellipse cx="${w.x - 9}" cy="${w.y - 3}" rx="5" ry="10" fill="${paint("hubs")}" stroke="${shade(colors.hubs, -.25)}" stroke-width=".8"/>
      <ellipse cx="${w.x + 1}" cy="${w.y}" rx="10" ry="12" fill="${paint("hubs")}" stroke="${shade(colors.hubs, -.25)}" stroke-width=".8"/>
      <ellipse cx="${w.x + 2}" cy="${w.y}" rx="5.3" ry="6.3" fill="url(#${id("steel")})" stroke="#98A2A9" stroke-width=".6"/>
      <path d="M${w.x} ${w.y - 2.5} l3 -.4 1.3 2.4 -1.3 2.7 -3 .3 -1.2 -2.4Z" fill="#7C8993"/>
      <path d="M${w.x - 5} ${w.y - 7} Q${w.x} ${w.y - 12} ${w.x + 6} ${w.y - 8}" fill="none" stroke="#FFFFFF" stroke-opacity=".74" stroke-width="1.1"/>`).join("");

    const framePath = "M240 365 L367 244 L402 345 Z M367 244 L620 184 M402 345 L632 223 M367 244 L402 345 M616 174 L633 229";
    const frame = tube("M233 360 L358 242", "frame", 7.3, [233,360,358,242], true)
      + tube("M233 360 L396 338", "frame", 8.8, [233,360,396,338], true)
      + tube("M242 365 L367 244", "frame", 8.6, [242,365,367,244])
      + tube("M242 365 L402 345", "frame", 10.2, [242,365,402,345])
      + tube("M367 244 L620 184", "frame", 15.2, [367,244,620,184])
      + tube("M402 345 L632 223", "frame", 19.5, [402,345,632,223])
      + tube("M367 244 L402 345", "frame", 15.7, [367,244,402,345])
      + tube("M616 174 L633 229", "frame", 22, [616,174,633,229])
      + `<path d="M237 360 l15 -2 6 7 -17 6Z" fill="${paint("frame")}" stroke="${shade(colors.frame, -.3)}" stroke-width=".8"/>
        <path d="M360 247 l12 -4 M361 250 l12 -4 M601 182 l3 13 M598 183 l3 13 M415 333 l6 10 M418 331 l6 10 M373 264 l13 -4" fill="none" stroke="${shade(colors.frame, -.19)}" stroke-opacity=".65" stroke-width=".9"/>
        <path d="M369 238 L600 183 M419 331 L615 226" fill="none" stroke="${shade(colors.frame, .8)}" stroke-opacity=".48" stroke-width="1.05" stroke-linecap="round"/>
        <ellipse cx="402" cy="345" rx="19" ry="21" fill="${paint("frame")}" stroke="${shade(colors.frame, -.25)}" stroke-width=".9"/>`;
    const fork = tube("M639 227 L677 362 Q680 371 681 374", "fork", 10, [639,227,681,374], true)
      + tube("M631 228 L664 353 Q667 372 671 378", "fork", 12.4, [631,228,671,378])
      + `<path d="M633 235 L664 355" fill="none" stroke="${shade(colors.fork, .8)}" stroke-width="1.05" stroke-opacity=".62" stroke-linecap="round"/>
        <path d="M665 369 L680 370 L681 382 L669 386Z" fill="${paint("fork")}" stroke="${shade(colors.fork, -.26)}" stroke-width=".9"/>
        <path d="M624 231 L639 227" stroke="${shade(colors.fork, -.2)}" stroke-width="3.1" stroke-linecap="round"/>
        <path d="M615 173 L611 159" stroke="${paint("fork")}" stroke-width="12"/>
        <path d="M607 169 L621 165 M606 166 L620 162" stroke="${shade(colors.fork, -.24)}" stroke-width="2.3" stroke-linecap="round"/>
        <path d="M598 154 L623 146 L633 150 L634 161 L606 171 L599 166Z" fill="${paint("fork")}" stroke="${shade(colors.fork, -.28)}" stroke-width=".85"/>
        <path d="M600 155 L624 148 L631 151 L606 160Z" fill="${shade(colors.fork, .36)}"/>
        <path d="M608 164 L630 156" stroke="${shade(colors.fork, -.19)}" stroke-width="1"/>
        <ellipse cx="603" cy="161" rx="1.6" ry="2" fill="#929EA5"/><ellipse cx="628" cy="153" rx="1.6" ry="2" fill="#929EA5"/>`;
    // Tall backswept near upright and narrower projected far upright, with a
    // welded crossbar: the slight angle matches the rest of the bike geometry.
    const barsPath = barStyle === "four-piece"
      ? "M572 41 L584 41 L616 151 L627 147 L627 58 L621 52 M598 87 L627 94"
      : "M571 41 L581 41 Q585 41 587 48 L614 141 Q618 154 625 149 Q630 146 629 135 L625 60 Q624 50 620 53 M598 89 L626 96";
    const bars = tube(barStyle === "four-piece" ? "M627 147 L627 58 L621 52" : "M625 149 Q630 146 629 135 L625 60 Q624 50 620 53", "bars", 7.2, [625,149,625,58], true)
      + tube(barStyle === "four-piece" ? "M598 87 L627 94" : "M598 89 L626 96", "bars", 6.1, [598,89,626,96])
      + tube(barStyle === "four-piece" ? "M572 41 L584 41 L616 151 L627 147" : "M571 41 L581 41 Q585 41 587 48 L614 141 Q618 154 625 149", "bars", 8.3, [585,45,616,148])
      + `<path d="M589 52 L615 140" fill="none" stroke="${shade(colors.bars, .8)}" stroke-opacity=".62" stroke-width="1"/>
        ${barStyle === "four-piece" ? `<path d="M582 47 l7 -2 M611 146 l7 -2 M624 66 h7" stroke="${shade(colors.bars, -.2)}" stroke-width="1.3"/>` : ""}`;
    const grip = (far = false) => {
      const ribs = Array.from({ length: far ? 7 : 15 }, (_, i) => `<path d="M${far ? i * 1.6 + 1 : i * 2.3 + 2} -5.1 v9.8" stroke="${shade(colors.grips, -.23)}" stroke-width=".7" opacity=".7"/>`).join("");
      return `<g transform="${far ? "translate(619 52) rotate(-63)" : "translate(543 39) rotate(3)"}"><rect x="0" y="-6.2" width="${far ? 17 : 39}" height="12.4" rx="5.5" fill="${paint("grips")}" stroke="${shade(colors.grips, -.27)}" stroke-width=".8"/>${ribs}<path d="M3 -4.3 H${far ? 12 : 34}" stroke="${shade(colors.grips, .7)}" stroke-width=".9"/><ellipse cx="0" cy="0" rx="2.8" ry="5.3" fill="${shade(colors.grips, -.12)}" stroke="${shade(colors.grips, -.29)}" stroke-width=".6"/><ellipse cx="${far ? 14 : 37}" cy="0" rx="2.6" ry="8" fill="${paint("grips")}" stroke="${shade(colors.grips, -.25)}" stroke-width=".7"/></g>`;
    };
    const grips = grip(true) + grip();
    const seat = tube("M367 244 L354 210", "seat", 10.4, [367,244,354,210])
      + `<path d="M345 217 L374 204 L379 199 M344 217 L324 216" fill="none" stroke="${shade(colors.seat, -.32)}" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M359 234 L372 230" stroke="${shade(colors.seat, -.23)}" stroke-width="4.4" stroke-linecap="round"/>
        ${seatStyle === "padded"
          ? `<path d="M299 202 Q319 193 340 189 L380 177 Q391 175 397 183 Q403 191 393 195 L365 207 Q336 226 308 223 Q297 221 296 213 Q295 206 299 202Z" fill="${paint("seat")}" stroke="${shade(colors.seat, -.24)}" stroke-width="1"/><path d="M302 203 Q332 197 355 189 L382 181 Q390 179 394 185" fill="none" stroke="${shade(colors.seat, .64)}" stroke-width="1.5"/><path d="M302 213 Q321 221 354 205 L386 192" fill="none" stroke="${shade(colors.seat, -.19)}" stroke-width=".75" stroke-dasharray="2 2"/>`
          : `<path d="M300 205 Q318 196 339 193 L381 180 Q391 178 396 185 Q400 191 390 195 L363 205 Q337 220 311 220 Q299 220 298 213 Q297 208 300 205Z" fill="${paint("seat")}" stroke="${shade(colors.seat, -.24)}" stroke-width=".95"/><path d="M303 205 Q328 199 345 194 L383 183 Q389 182 392 186" fill="none" stroke="${shade(colors.seat, .7)}" stroke-width="1.4"/><path d="M304 216 Q331 219 360 204 L387 194" fill="none" stroke="${shade(colors.seat, -.15)}" stroke-width=".7"/>`}`;
    const gearPoints = Array.from({ length: 75 }, (_, i) => point(405, 348, i % 3 === 1 ? 31.7 : 29.7, i % 3 === 1 ? 34.6 : 32.6, i * Math.PI * 2 / 75)).join(" ");
    const gearHoles = Array.from({ length: 5 }, (_, i) => { const a = i * Math.PI * 2 / 5; const x = 405 + Math.cos(a) * 18.4, y = 348 + Math.sin(a) * 20.4; return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="5.4" ry="9.2" transform="rotate(${n(i * 72 - 90)} ${n(x)} ${n(y)})" fill="#000"/>`; }).join("");
    const sprocket = `<polygon points="${gearPoints}" fill="${paint("sprocket")}" stroke="${shade(colors.sprocket, -.3)}" stroke-width=".8" mask="url(#${id("gear-holes")})"/>
      <ellipse cx="405" cy="348" rx="27.4" ry="30" fill="none" stroke="${shade(colors.sprocket, .7)}" stroke-width="1"/>
      <ellipse cx="405" cy="348" rx="9" ry="10" fill="${paint("sprocket")}" stroke="${shade(colors.sprocket, -.28)}" stroke-width="1.1"/>`;
    const chainPath = "M241 354 L399 316 Q431 312 436 345 Q441 377 410 382 L243 378 Q230 378 229 366 Q228 355 241 354Z";
    const chain = `<g aria-hidden="true"><path d="${chainPath}" fill="none" stroke="#9BA7AC" stroke-width="4.7"/><path d="${chainPath}" fill="none" stroke="#DFE5E7" stroke-width="3.4"/><path d="${chainPath}" fill="none" stroke="#929FA7" stroke-width="2.1" stroke-dasharray="1.5 3.1"/><path d="${chainPath}" fill="none" stroke="#F6F8F9" stroke-width=".7" stroke-dasharray="1.4 3.2" stroke-dashoffset="1.5"/></g>`;
    const cranks = tube("M405 348 L477 330", "cranks", 11.2, [405,348,477,330])
      + `<path d="M414 346 L471 331" stroke="${shade(colors.cranks, .65)}" stroke-width="1.2" stroke-linecap="round"/><ellipse cx="405" cy="348" rx="6.4" ry="7.1" fill="url(#${id("steel")})" stroke="#A0ABB1" stroke-width=".7"/><path d="M402 346 l3 -1 3 2 -.3 3 -3 1 -3 -2Z" fill="#7F8D96"/><ellipse cx="477" cy="330" rx="4.7" ry="5.2" fill="${paint("cranks")}" stroke="${shade(colors.cranks, -.25)}" stroke-width=".8"/>`;
    const pedal = (x, y, far = false) => `<g transform="translate(${x} ${y})${far ? ' scale(.83)' : ''}"><path d="M-15 1 L16 -13 L27 -6 L-5 10Z" fill="${paint("pedals")}" stroke="${shade(colors.pedals, -.28)}" stroke-width=".9"/><path d="M-15 1 L-15 8 L-5 17 L27 1 V-6 L-5 10Z" fill="${shade(colors.pedals, -.14)}" stroke="${shade(colors.pedals, -.3)}" stroke-width=".9"/><path d="M-8 1 L3 -4 L7 -1 L-4 4Z M6 -6 L16 -10 L20 -7 L10 -3Z" fill="${shade(colors.pedals, -.31)}"/><path d="M-9 8 L-6 11 L-6 14 L-9 11Z M0 10 L8 6 V10 L0 14Z M13 4 L21 0 V4 L13 8Z" fill="${shade(colors.pedals, -.34)}"/><path d="M-12 1 L17 -11" stroke="${shade(colors.pedals, .7)}" stroke-width="1"/>${[[-10,1],[1,-4],[14,-10],[22,-6],[-3,8]].map(([a,b]) => `<path d="M${a} ${b} v-2.5" stroke="#A9B3B8" stroke-width="1.4" stroke-linecap="round"/>`).join("")}</g>`;
    const peg = w => `<g transform="translate(${w.x + 1} ${w.y}) rotate(18)"><path d="M0 -7 L27 -7 Q33 -7 33 0 Q33 7 27 7 H0Z" fill="url(#${id("peg")})" stroke="#A6AFB4" stroke-width=".8"/><path d="M3 -4 H27" stroke="#FFFFFF" stroke-opacity=".72" stroke-width=".8"/><ellipse cx="29.5" cy="0" rx="3.4" ry="6" fill="#8A969D" stroke="#CBD2D6" stroke-width=".8"/><ellipse cx="30" cy="0" rx="1.6" ry="3.1" fill="#64717A"/>${[7,10,13,16,19,22].map(x=>`<path d="M${x} -5 V5" stroke="#A6B0B7" stroke-opacity=".62" stroke-width=".6"/>`).join("")}</g>`;
    const pegContent = pegs === "none" ? "" : peg(wheels[0]) + (pegs === "both" ? peg(wheels[1]) : "");
    const decalContent = decal === "none" ? "" : `<g transform="translate(511 287) rotate(-28)">${decal === "lightning" ? `<path d="M-8 -7 H5 L-2 -1 H11 L-8 10 L-1 2 H-13 L-7 -4 H-15Z" fill="${shade(colors.frame, -.47)}"/>` : `<text x="0" y="4" text-anchor="middle" fill="${shade(colors.frame, -.57)}" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="11.6" letter-spacing="1">JKCREW</text><path d="M-26 7 H26" stroke="${shade(colors.frame, -.35)}" stroke-width=".7"/>`}</g>`;
    const gradients = Object.entries(colors).map(([part, color]) => `<linearGradient id="${id(part)}" x1=".1" y1="0" x2=".7" y2="1"><stop stop-color="${shade(color, .42)}"/><stop offset=".33" stop-color="${color}"/><stop offset=".66" stop-color="${shade(color, -.09)}"/><stop offset="1" stop-color="${shade(color, -.27)}"/></linearGradient>`).join("");
    // Build all tube geometry before serialising the generated gradient list.
    const farCrank = tube("M400 344 L341 358", "cranks", 9.3, [400,344,341,358], true);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 540" preserveAspectRatio="xMidYMid meet" ${interactive ? 'role="group"' : 'role="img"'} aria-labelledby="${id("title")}" class="jkcrew-bike-art" style="display:block;width:100%;height:auto;overflow:visible">
      <title id="${id("title")}">Custom BMX bike${interactive ? "; select a part to customize it" : ""}</title>
      <defs>${gradients}${tubeGradients.join("")}
        <linearGradient id="${id("rubber")}" x1="0" y1="0" x2=".65" y2="1"><stop stop-color="${whiteTyre ? "#FDFDFE" : "#485055"}"/><stop offset=".45" stop-color="${whiteTyre ? "#F2F4F7" : "#272D31"}"/><stop offset=".78" stop-color="${whiteTyre ? "#DFE3E8" : "#181E22"}"/><stop offset="1" stop-color="${whiteTyre ? "#CED5DD" : "#0C1317"}"/></linearGradient>
        <linearGradient id="${id("tyre-shoulder")}" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="${whiteTyre ? "#C5CDD4" : "#11191D"}"/><stop offset=".5" stop-color="${whiteTyre ? "#EEF1F5" : "#465055"}"/><stop offset="1" stop-color="${whiteTyre ? "#D5DCE3" : "#182025"}"/></linearGradient>
        <linearGradient id="${id("steel")}" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#F9FBFC"/><stop offset=".25" stop-color="#CED6DB"/><stop offset=".48" stop-color="#F3F6F8"/><stop offset="1" stop-color="#91A0AA"/></linearGradient>
        <linearGradient id="${id("peg")}" x2="0" y2="1"><stop stop-color="#E7ECEF"/><stop offset=".3" stop-color="#F8FAFB"/><stop offset="1" stop-color="#8E9CA6"/></linearGradient>
        <mask id="${id("gear-holes")}" maskUnits="userSpaceOnUse" x="369" y="309" width="72" height="78"><rect x="369" y="309" width="72" height="78" fill="#FFF"/>${gearHoles}</mask>
        <filter id="${id("shadow")}" x="-.2" y="-2" width="1.4" height="5"><feGaussianBlur stdDeviation="8"/></filter>
        <filter id="${id("contact-shadow")}" x="-.2" y="-2" width="1.4" height="5"><feGaussianBlur stdDeviation="2.4"/></filter>
        <filter id="${id("selected")}" x="-.4" y="-.5" width="1.8" height="2"><feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="#7E8493" flood-opacity=".27"/></filter>
      </defs>
      <g aria-hidden="true"><ellipse cx="454" cy="500" rx="300" ry="13" fill="#65767E" fill-opacity=".13" filter="url(#${id("shadow")})"/><ellipse cx="239" cy="484" rx="55" ry="3.2" fill="#53636C" fill-opacity=".2" filter="url(#${id("contact-shadow")})"/><ellipse cx="669" cy="506" rx="60" ry="3.4" fill="#53636C" fill-opacity=".25" filter="url(#${id("contact-shadow")})"/></g>
      ${group("tyres", tyres, wheels.map(w => hit("ellipse", `cx="${w.x}" cy="${w.y}" rx="${w.rx + 2}" ry="${w.ry + 2}"`, 22)).join(""))}
      <g aria-hidden="true">${spokes}</g>
      ${group("rims", rims, wheels.map(w => hit("ellipse", `cx="${w.x}" cy="${w.y}" rx="${w.rx - 13}" ry="${w.ry - 13}"`, 17)).join(""))}
      ${group("cranks", farCrank, hit("path", 'd="M400 344 L341 358"'))}${group("pedals", pedal(337, 353, true), hit("path", 'd="M323 355 L358 344"'))}
      ${group("frame", frame, hit("path", `d="${framePath}"`))}
      ${group("fork", fork, hit("path", 'd="M631 228 L671 378 M613 174 L608 157 L628 153"'))}
      ${group("seat", seat, hit("path", 'd="M304 211 L389 187 M354 213 L367 240"'))}
      ${group("bars", bars, hit("path", `d="${barsPath}"`))}
      ${group("grips", grips, hit("path", 'd="M544 39 L581 41 M620 51 L627 37"'))}
      <ellipse cx="239" cy="365" rx="11.5" ry="13" fill="url(#${id("steel")})" stroke="#A0ABB1" stroke-width=".7"/>
      ${group("sprocket", sprocket, hit("ellipse", 'cx="405" cy="348" rx="20" ry="22"'))}${chain}
      ${group("cranks", cranks, hit("path", 'd="M405 348 L477 330"'))}
      ${group("pedals", pedal(483, 323), hit("path", 'd="M469 326 L510 313"'))}
      ${group("hubs", hubs, wheels.map(w => hit("ellipse", `cx="${w.x}" cy="${w.y}" rx="6" ry="8"`, 20)).join(""))}
      ${group("pegs", pegContent, pegs !== "none" ? hit("path", `d="M241 365 l30 10${pegs === "both" ? " M672 378 l30 10" : ""}"`) : "")}
      ${group("decal", decalContent, hit("path", 'd="M478 305 L546 269"', 19))}
    </svg>`;
  }
  return Object.freeze({ render });
})();

globalThis.JKCrewBikeArt = JKCrewBikeArt;
