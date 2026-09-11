/* Original code-drawn BMX artwork. Pure SVG renderer; callers provide a unique
 * idPrefix when several bikes are shown in the same document. */
const JKCrewBikeArt = (() => {
  "use strict";
  const defaults = {
    frame: "#22B8A7", fork: "#344353", bars: "#C8D2DF", grips: "#F4AE42",
    rims: "#526173", hubs: "#F4AE42", seat: "#253140", pedals: "#F4AE42",
    cranks: "#C8D2DF", sprocket: "#AAB8C9",
  };
  const names = { frame: "Frame", fork: "Fork", bars: "Handlebars", grips: "Grips", rims: "Wheel rims", hubs: "Wheel hubs", seat: "Seat", pedals: "Pedals", cranks: "Cranks", sprocket: "Sprocket", tyres: "Tyres", pegs: "Pegs", decal: "Frame decal" };
  const shade = (hex, amount) => {
    const target = amount < 0 ? 0 : 255, strength = Math.abs(amount);
    return "#" + [1, 3, 5].map(offset => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * (1 - strength) + target * strength).toString(16).padStart(2, "0")).join("");
  };
  const choice = (value, options, fallback) => options.includes(value) ? value : fallback;
  const point = (x, y, radius, angle) => `${(x + Math.cos(angle) * radius).toFixed(2)},${(y + Math.sin(angle) * radius).toFixed(2)}`;

  function render(config = {}, { idPrefix = "bike", selectedPart = "", interactive = false } = {}) {
    config = config && typeof config === "object" ? config : {};
    const colors = Object.fromEntries(Object.entries(defaults).map(([part, fallback]) => [part, typeof config.colors?.[part] === "string" && /^#[0-9a-f]{6}$/i.test(config.colors[part]) ? config.colors[part].toUpperCase() : fallback]));
    const barStyle = choice(config.barStyle, ["two-piece", "four-piece"], "two-piece");
    const tyreStyle = choice(config.tyreStyle, ["black", "tan-wall", "white-wall"], "black");
    const seatStyle = choice(config.seatStyle, ["slim", "padded"], "slim");
    const pegs = choice(config.pegs, ["none", "rear", "both"], "none");
    const decal = choice(config.decal, ["jkcrew", "lightning", "none"], "jkcrew");
    const prefix = "bmx-" + (String(idPrefix || "bike").replace(/[^a-z0-9_-]/gi, "-").slice(0, 64) || "bike");
    const id = name => `${prefix}-${name}`;
    const paint = part => `url(#${id(part)})`;
    const selected = Object.hasOwn(names, selectedPart) ? selectedPart : "";
    const hit = (shape, attributes) => interactive ? `<${shape} ${attributes} fill="none" stroke="transparent" stroke-width="30" pointer-events="stroke"/>` : "";
    const group = (part, content, hitArea = "") => `<g${interactive ? ` data-bike-part="${part}" role="button" tabindex="0" aria-label="Customize ${names[part].toLowerCase()}" style="cursor:pointer"` : ""}${selected === part ? ` filter="url(#${id("selected")})"` : ""}><title>${names[part]}</title>${hitArea}${content}</g>`;
    const tube = (d, part, width, extra = "") => `<path d="${d}" fill="none" stroke="#111c26" stroke-width="${width + 3}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${paint(part)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
    const wheels = [250, 668], wheelY = 345;
    const wheelSpokes = wheels.map(x => {
      const lines = Array.from({ length: 36 }, (_, i) => {
        const angle = i * Math.PI / 18, hubAngle = angle + (i % 2 ? 0.64 : -0.64);
        return `<path d="M${point(x, wheelY, 11, hubAngle)} L${point(x, wheelY, 95, angle)}" stroke="${i % 2 ? "#748697" : "#B4C1CD"}" stroke-width="${i % 2 ? 0.85 : 0.65}" opacity="${i % 2 ? 0.64 : 0.49}"/>`;
      }).join("");
      return `<circle cx="${x}" cy="${wheelY}" r="95" fill="#738EA2" fill-opacity=".035"/>${lines}`;
    }).join("");
    const tyres = wheels.map(x => {
      const wall = tyreStyle === "tan-wall" ? "#C79E66" : "#E9E7DB";
      const treads = Array.from({ length: 54 }, (_, i) => {
        const angle = i * Math.PI * 2 / 54;
        return `<path d="M${point(x, wheelY, 116.4, angle)} L${point(x, wheelY, 119.1, angle + 0.015)}" stroke="#64717B" stroke-opacity=".22" stroke-width="1.6" stroke-linecap="round"/>`;
      }).join("");
      return `<circle cx="${x}" cy="${wheelY}" r="109.5" fill="none" stroke="url(#${id("rubber")})" stroke-width="23"/>
        <circle cx="${x}" cy="${wheelY}" r="119.6" fill="none" stroke="#53606B" stroke-opacity=".34" stroke-width="1"/>
        ${tyreStyle !== "black" ? `<circle cx="${x}" cy="${wheelY}" r="108.2" fill="none" stroke="${wall}" stroke-width="8.1"/><circle cx="${x}" cy="${wheelY}" r="111.8" fill="none" stroke="#FFF3D9" stroke-opacity=".35" stroke-width=".9"/>` : `<circle cx="${x}" cy="${wheelY}" r="109.6" fill="none" stroke="#36424D" stroke-opacity=".6" stroke-width="1.2"/>`}${treads}
        <path d="M${point(x, wheelY, 113, -2.53)} A113 113 0 0 1 ${point(x, wheelY, 113, -1.08)}" fill="none" stroke="#D9E5EB" stroke-opacity=".12" stroke-width="2.3" stroke-linecap="round"/>
        <text x="${x - 19}" y="239" fill="${tyreStyle === "black" ? "#84949F" : "#574630"}" font-family="Arial,sans-serif" font-size="5.8" font-weight="700" letter-spacing="1" opacity=".65">20 × 2.40</text>`;
    }).join("");
    const rims = wheels.map(x => `<circle cx="${x}" cy="${wheelY}" r="98.2" fill="none" stroke="#0D1720" stroke-width="11"/><circle cx="${x}" cy="${wheelY}" r="98.2" fill="none" stroke="${paint("rims")}" stroke-width="7.8"/><circle cx="${x}" cy="${wheelY}" r="94.8" fill="none" stroke="${shade(colors.rims, .48)}" stroke-opacity=".72" stroke-width="1"/><circle cx="${x}" cy="${wheelY}" r="102" fill="none" stroke="#E8F2F7" stroke-opacity=".36" stroke-width=".8"/><path d="M${x + 69} 410 L${x + 65} 406" stroke="#E2E7EB" stroke-width="2.5" stroke-linecap="round"/>`).join("");
    const hubs = wheels.map(x => `<circle cx="${x}" cy="345" r="14" fill="#101B25"/><circle cx="${x}" cy="345" r="11.4" fill="${paint("hubs")}" stroke="${shade(colors.hubs, -.4)}" stroke-width="1.3"/><circle cx="${x}" cy="345" r="5.8" fill="url(#${id("steel")})" stroke="#17242E" stroke-width="1.5"/><path d="M${x - 2} 342 l4 0 2 3 -2 3 -4 0 -2 -3 Z" fill="#233440"/><path d="M${x - 8} 341 A9 9 0 0 1 ${x + 4} 337" fill="none" stroke="#F1FAFF" stroke-opacity=".75" stroke-width="1.1"/>`).join("");
    const framePath = "M250 345 L381 228 L430 337 Z M381 228 L597 218 M430 337 L615 263 M381 228 L430 337";
    const frame = tube("M250 345 L381 228", "frame", 8.3) + tube("M250 345 L430 337", "frame", 10.5)
      + tube("M381 228 L597 218", "frame", 15.5) + tube("M430 337 L615 263", "frame", 20)
      + tube("M381 228 L430 337", "frame", 14.5) + tube("M595 210 L615 267", "frame", 20)
      + `<path d="M384 223 L581 214 M444 327 L599 265" stroke="#EEFFFB" stroke-opacity=".27" stroke-width="1.6" stroke-linecap="round"/>
         <path d="M393 255 l11 -5 M392 252 l11 -5 M566 218 l1 8 M570 218 l1 8 M446 325 l3 8" stroke="${shade(colors.frame, .5)}" stroke-opacity=".65" stroke-width="1.1"/>
         <path d="M247 340 l9 0 8 -4" fill="none" stroke="${shade(colors.frame, -.22)}" stroke-width="10" stroke-linecap="round"/>
         <circle cx="430" cy="337" r="21" fill="${paint("frame")}" stroke="#192E35" stroke-width="1.8"/>`;
    const fork = tube("M614 264 L639 329 Q643 342 662 345", "fork", 10.5)
      + `<path d="M608 267 L632 334 Q637 345 654 347" fill="none" stroke="${shade(colors.fork, -.25)}" stroke-width="7.5" stroke-linecap="round"/>
         <path d="M616 271 L638 329 Q642 340 655 342" fill="none" stroke="${shade(colors.fork, .55)}" stroke-opacity=".75" stroke-width="1.5" stroke-linecap="round"/>
         <path d="M610 262 L618 260 M595 210 L585 181" stroke="url(#${id("steel")})" stroke-width="9" stroke-linecap="round"/>
         <path d="M606 263 L620 259" stroke="#A4B7C8" stroke-width="4" stroke-linecap="round"/>
         <path d="M587 181 L604 179" stroke="#202D3C" stroke-width="15" stroke-linecap="round"/>
         <path d="M586 175 L604 173" stroke="#6E8397" stroke-width="3" stroke-linecap="round"/>
         <circle cx="602" cy="179" r="3.1" fill="#C7D5E0" stroke="#101C27" stroke-width="1.2"/>`;
    const barsPath = barStyle === "four-piece"
      ? "M517 110 L550 110 L571 176 L605 176 L626 108 L661 108 M560 143 L615 143"
      : "M516 110 L535 111 L547 154 Q553 177 574 177 L603 177 Q623 177 630 154 L644 109 L661 109 M542 135 L635 135";
    const bars = tube(barsPath, "bars", 7.1)
      + `<path d="${barStyle === "four-piece" ? "M553 113 L571 171 M629 111 L613 164 M563 140 L611 140" : "M537 114 L549 153 Q553 169 564 172 M545 132 L632 132 M642 113 L630 151"}" fill="none" stroke="${shade(colors.bars, .72)}" stroke-width="1.1" stroke-opacity=".9" stroke-linecap="round"/>
        ${barStyle === "four-piece" ? `<path d="M547 114 l7 -2 M622 112 l7 2 M566 172 l8 -2 M602 173 l8 3" stroke="${shade(colors.bars, -.25)}" stroke-width="1.5"/>` : ""}`;
    const grips = [[492, 110], [655, 109]].map(([x, y]) => {
      const rings = Array.from({ length: 11 }, (_, i) => `<path d="M${x + 5 + i * 3} ${y - 5.4} v10.8" stroke="${shade(colors.grips, -.28)}" stroke-width="1.15" opacity=".75"/>`).join("");
      return `<rect x="${x}" y="${y - 6.5}" width="42" height="13" rx="5" fill="${paint("grips")}" stroke="#17232B" stroke-width="1.5"/>${rings}<path d="M${x + 5} ${y - 5} h30" stroke="${shade(colors.grips, .65)}" stroke-opacity=".8" stroke-width="1.2"/><rect x="${x - 1}" y="${y - 7}" width="4" height="14" rx="1.6" fill="#18222D"/><rect x="${x + 39}" y="${y - 7}" width="4" height="14" rx="1.6" fill="#293542"/>`;
    }).join("");
    const seat = `<path d="M381 228 L364 187" stroke="#192734" stroke-width="12" stroke-linecap="round"/><path d="M379 219 L365 187" stroke="url(#${id("steel")})" stroke-width="8" stroke-linecap="round"/><path d="M369 187 L344 192 L327 188" fill="none" stroke="#8E9EAC" stroke-width="3" stroke-linecap="round"/><path d="M373 223 L386 218" stroke="#131F29" stroke-width="7" stroke-linecap="round"/>
      ${seatStyle === "padded"
        ? `<path d="M311 174 Q314 164 336 165 Q357 167 371 170 Q393 170 401 179 Q403 186 392 189 L329 190 Q314 188 311 181 Z" fill="${paint("seat")}" stroke="#101922" stroke-width="2"/><path d="M316 174 Q332 169 355 175 L390 178" fill="none" stroke="${shade(colors.seat, .47)}" stroke-width="1.8"/><path d="M324 179 Q345 186 389 182" fill="none" stroke="${shade(colors.seat, .2)}" stroke-width="1" stroke-dasharray="3 3"/>`
        : `<path d="M314 177 Q325 171 344 175 L367 179 Q390 176 400 181 Q402 186 394 188 L333 188 Q318 187 313 182 Z" fill="${paint("seat")}" stroke="#101922" stroke-width="1.8"/><path d="M318 178 Q331 175 346 179 L373 182 L391 181" fill="none" stroke="${shade(colors.seat, .48)}" stroke-width="1.4"/>`}`;
    const gearPoints = Array.from({ length: 60 }, (_, i) => point(430, 337, i % 3 === 1 ? 32.7 : 30.1, i * Math.PI / 30)).join(" ");
    const sprocket = `<polygon points="${gearPoints}" fill="${paint("sprocket")}" stroke="#1C2935" stroke-width="1.5"/>
      <circle cx="430" cy="337" r="26" fill="none" stroke="${shade(colors.sprocket, .65)}" stroke-width="1.1"/>
      ${Array.from({ length: 5 }, (_, i) => { const a = i * Math.PI * 2 / 5; return `<ellipse cx="${430 + Math.cos(a) * 18}" cy="${337 + Math.sin(a) * 18}" rx="7.7" ry="5" transform="rotate(${i * 72} ${430 + Math.cos(a) * 18} ${337 + Math.sin(a) * 18})" fill="#15222E" stroke="${shade(colors.sprocket, -.15)}" stroke-width="1"/>`; }).join("")}
      <circle cx="430" cy="337" r="9.5" fill="${paint("sprocket")}" stroke="#20303E" stroke-width="2"/>`;
    const chainPath = "M249 333 L427 306 Q460 305 462 337 Q462 368 429 368 L249 357 Q235 357 235 345 Q235 333 249 333 Z";
    const chain = `<g aria-hidden="true"><path d="${chainPath}" fill="none" stroke="#0C151E" stroke-width="5.5"/><path d="${chainPath}" fill="none" stroke="#84939D" stroke-width="3.5"/><path d="${chainPath}" fill="none" stroke="#263642" stroke-width="2.4" stroke-dasharray="2.2 3.3"/><path d="M253 333 L419 309" fill="none" stroke="#E7EFF4" stroke-opacity=".5" stroke-width=".8"/></g>`;
    const cranks = tube("M430 337 L477 391", "cranks", 10.7)
      + `<path d="M433 339 L477 387" fill="none" stroke="${shade(colors.cranks, .7)}" stroke-width="1.5" stroke-linecap="round"/><circle cx="430" cy="337" r="7.1" fill="url(#${id("steel")})" stroke="#142531" stroke-width="1.7"/><path d="M426 335 l4 -2 4 2 v5 l-4 2 -4 -2Z" fill="#263849"/><circle cx="478" cy="391" r="5" fill="#233242" stroke="${shade(colors.cranks, .45)}" stroke-width="1.5"/>`;
    const pedal = (x, y, far = false) => `<g${far ? ' opacity=".8"' : ""}><path d="M${x - 27} ${y - 6} L${x + 23} ${y - 6} L${x + 29} ${y - 2} L${x + 26} ${y + 7} L${x - 26} ${y + 7} L${x - 30} ${y + 2} Z" fill="${paint("pedals")}" stroke="#17232C" stroke-width="2"/><path d="M${x - 23} ${y - 3} h41" stroke="${shade(colors.pedals, .56)}" stroke-width="1.5"/><rect x="${x - 20}" y="${y}" width="15" height="3.5" rx="1" fill="${shade(colors.pedals, -.62)}"/><rect x="${x + 4}" y="${y}" width="15" height="3.5" rx="1" fill="${shade(colors.pedals, -.62)}"/>${[-22,-11,11,22].map(offset => `<path d="M${x + offset} ${y - 7} v-2.5" stroke="#D6E0E7" stroke-width="1.8"/>`).join("")}</g>`;
    const peg = x => `<g transform="translate(${x},345) rotate(13)"><path d="M0 -7 L31 -7 Q36 -7 36 0 Q36 7 31 7 H0 Z" fill="url(#${id("peg")})" stroke="#12212D" stroke-width="1.6"/><path d="M4 -4 H29" stroke="#B8C9D8" stroke-opacity=".65" stroke-width="1.1"/><ellipse cx="32.5" cy="0" rx="3.5" ry="6" fill="#1A2A39" stroke="#728394" stroke-width="1"/><path d="M9 -5 V5 M13 -5 V5 M17 -5 V5 M21 -5 V5" stroke="#0C1823" stroke-opacity=".55" stroke-width="1"/></g>`;
    const pegContent = pegs === "none" ? "" : peg(250) + (pegs === "both" ? peg(668) : "");
    const decalContent = decal === "none" ? "" : `<g transform="translate(519 301) rotate(-21.9)">${decal === "lightning"
      ? `<path d="M-12 -6 H1 L-5 0 H9 L-8 10 L-2 2 H-14 L-8 -4 H-16Z" fill="#F8F5DB"/><path d="M10 -6 H14 L7 1 H3Z" fill="#F8F5DB" opacity=".7"/>`
      : `<text x="0" y="4.2" text-anchor="middle" fill="${shade(colors.frame, -.78)}" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="12.5" letter-spacing=".7">JKCREW</text><path d="M-28 7 H28" stroke="${shade(colors.frame, -.58)}" stroke-width="1" stroke-opacity=".6"/>`}</g>`;
    const gradients = Object.entries(colors).map(([part, color]) => `<linearGradient id="${id(part)}" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${shade(color, .4)}"/><stop offset=".32" stop-color="${color}"/><stop offset=".62" stop-color="${shade(color, -.13)}"/><stop offset="1" stop-color="${shade(color, -.4)}"/></linearGradient>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 540" preserveAspectRatio="xMidYMid meet" ${interactive ? 'role="group"' : 'role="img"'} aria-labelledby="${id("title")}" class="jkcrew-bike-art" style="display:block;width:100%;height:auto;overflow:visible">
      <title id="${id("title")}">Custom BMX bike${interactive ? "; select a part to customize it" : ""}</title>
      <defs>${gradients}
        <radialGradient id="${id("rubber")}" cx=".34" cy=".23" r=".83"><stop offset="0" stop-color="#303B46"/><stop offset=".64" stop-color="#131D27"/><stop offset="1" stop-color="#050C13"/></radialGradient>
        <linearGradient id="${id("steel")}" x2=".7" y2="1"><stop stop-color="#F0F5FA"/><stop offset=".26" stop-color="#879CAA"/><stop offset=".5" stop-color="#DDE8EF"/><stop offset="1" stop-color="#546777"/></linearGradient>
        <linearGradient id="${id("peg")}" x2="0" y2="1"><stop stop-color="#647788"/><stop offset=".3" stop-color="#26394A"/><stop offset="1" stop-color="#091622"/></linearGradient>
        <filter id="${id("shadow")}" x="-.15" y="-1" width="1.3" height="3"><feGaussianBlur stdDeviation="7"/></filter>
        <filter id="${id("selected")}" x="-.4" y="-.5" width="1.8" height="2"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#86F2E4" flood-opacity=".78"/></filter>
      </defs>
      <ellipse cx="459" cy="470" rx="328" ry="12" fill="#00050C" fill-opacity=".4" filter="url(#${id("shadow")})"/>
      ${group("tyres", tyres, wheels.map(x => hit("circle", `cx="${x}" cy="345" r="110"`)).join(""))}
      <g aria-hidden="true">${wheelSpokes}</g>
      ${group("rims", rims, wheels.map(x => hit("circle", `cx="${x}" cy="345" r="98"`)).join(""))}
      ${group("cranks", tube("M430 337 L387 292", "cranks", 9), hit("path", 'd="M430 337 L387 292"'))}${group("pedals", pedal(383, 291, true), hit("path", 'd="M355 291 H411"'))}
      ${group("frame", frame, hit("path", `d="${framePath} M595 210 L615 267"`))}
      ${group("fork", fork, hit("path", 'd="M614 264 L640 331 L667 345 M598 211 L585 179 L605 178"'))}
      ${group("seat", seat, hit("path", 'd="M316 180 L393 184 M364 190 L378 222"'))}
      ${group("bars", bars, hit("path", `d="${barsPath}"`))}
      ${group("grips", grips, hit("path", 'd="M492 110 H534 M655 109 H697"'))}
      <circle cx="250" cy="345" r="13" fill="#73838E" stroke="#21323D" stroke-width="2"/>
      ${group("sprocket", sprocket, hit("circle", 'cx="430" cy="337" r="20"'))}
      ${chain}
      ${group("cranks", cranks, hit("path", 'd="M430 337 L478 391"'))}
      ${group("pedals", pedal(486, 391), hit("path", 'd="M458 391 H514"'))}
      ${group("hubs", hubs, wheels.map(x => hit("circle", `cx="${x}" cy="345" r="8"`)).join(""))}
      ${group("pegs", pegContent, interactive && pegs !== "none" ? hit("path", `d="M250 345 l34 8${pegs === "both" ? " M668 345 l34 8" : ""}"`) : "")}
      ${group("decal", decalContent, interactive ? hit("path", 'd="M485 315 L552 288"') : "")}
    </svg>`;
  }
  return Object.freeze({ render });
})();

// Expose on the global object as well as the classic-script lexical binding.
globalThis.JKCrewBikeArt = JKCrewBikeArt;
