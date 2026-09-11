/* Material silhouettes traced against the 1536 × 1024 studio photographs.
 * Paths are unions unless fillRule is explicitly evenodd. excludePath is a
 * BLACK subtraction path when constructing an SVG mask, not another clip.
 * Bearings, bolts, chain links and spoke openings remain their photographed metal.
 */
const JKCrewBikePhotoMasks = (() => {
  'use strict';
  const ellipse = (x,y,rx,ry,angle=0) => {
    const a=angle*Math.PI/180,dx=rx*Math.cos(a),dy=rx*Math.sin(a);
    const f=v=>Number(v.toFixed(2));
    return `M${f(x-dx)} ${f(y-dy)} A${rx} ${ry} ${angle} 1 1 ${f(x+dx)} ${f(y+dy)} A${rx} ${ry} ${angle} 1 1 ${f(x-dx)} ${f(y-dy)}Z`;
  };
  const make = (path,bounds,excludePath='',fillRule='nonzero') => Object.freeze({path,bounds:Object.freeze(bounds),excludePath,fillRule});
  const frame = [
    // Head tube, bounded by the silver bearing rings above and below.
    'M1054 324 Q1069 321 1090 316 L1115 414 Q1099 419 1081 422 L1076 402 L1067 374Z',
    // Top tube and its weld at the seat tube.
    'M590 447 L1048 336 Q1054 334 1057 341 L1064 360 Q1060 365 1054 367 L610 472 Q599 470 595 460Z',
    // Down tube: the lower end is occluded by the chainring and crank.
    'M703 612 L1064 386 Q1069 383 1072 391 L1079 411 Q1078 415 1072 419 L720 640Z',
    // Seat tube starts below the separate metal seatpost collar.
    'M571 442 L593 436 Q599 444 603 460 L650 598 L627 605 L578 477 Q573 466 570 455Z',
    // Near seat stay and the thin far stay visible underneath it.
    'M319 657 L569 451 Q576 449 581 458 Q584 464 578 471 L335 674Z',
    'M339 658 L567 475 L571 484 L352 664Z',
    // Chain stays and the painted rear dropout. The centre nut is excluded.
    'M324 675 L602 654 L603 678 L348 699 Q334 708 315 705 Q304 701 302 691 Q301 679 309 672 L319 666Z',
    'M349 672 L598 657 L599 663 L352 681Z'
  ].join(' ');
  const fork = [
    // The visible near blade ends above its metal axle insert.
    'M1090 434 Q1102 432 1118 427 L1178 665 Q1182 678 1174 684 Q1168 689 1160 682 Q1154 677 1152 666Z',
    // Small visible shoulder and far blade; keep the wheel sidewall separate.
    'M1121 443 Q1132 455 1138 469 L1130 472Z',
    'M1149 533 L1184 668 L1179 678 L1168 642Z',
    // Dropout around the axle, not its silver nut/black socket.
    'M1161 679 Q1175 680 1182 687 Q1195 694 1196 708 Q1194 721 1184 725 Q1174 729 1166 720 L1157 693Z'
  ].join(' ');
  const bars = [
    'M989 57 Q1006 58 1014 78 Q1024 103 1036 138 L1091 268 Q1095 277 1088 283 Q1081 289 1073 282 Q1064 275 1059 260 L1000 89 Q997 79 989 75Z',
    'M1081 90 L1098 86 L1109 259 Q1111 271 1106 278 L1093 278 Q1094 268 1090 253Z',
    'M1036 136 L1095 145 Q1102 147 1100 153 Q1099 159 1092 158 L1041 150Z'
  ].join(' ');
  const grips = [
    'M902 45 Q925 45 949 47 L974 49 Q978 44 984 46 Q994 49 994 65 Q993 78 985 80 Q979 80 975 74 L904 73 Q891 73 891 60 Q891 47 902 45Z',
    'M1081 53 Q1087 49 1095 53 L1105 58 Q1111 62 1106 69 L1098 76 Q1099 85 1093 91 Q1087 97 1080 93 L1072 89 Q1067 86 1070 78 L1076 67 Q1074 61 1081 53Z'
  ].join(' ');
  const seat = 'M453 367 Q461 361 476 358 L628 323 Q646 319 654 326 Q662 332 662 343 Q662 348 650 351 L609 364 Q583 376 566 389 Q555 399 537 403 Q503 410 476 404 Q457 401 452 392 Q446 378 453 367Z';
  const pedals = 'M779 621 L836 606 Q840 600 846 606 L861 609 L867 614 L868 643 L850 648 L847 652 L831 656 L811 660 L804 663 L784 657 L780 649Z';
  const pedalHoles = [
    'M790 625 L805 622 L813 624 L799 629Z',
    'M821 617 L835 613 L846 615 L831 620Z',
    'M836 632 L852 627 L857 628 L857 639 L836 646Z',
    'M786 637 L793 638 L794 649 L787 647Z',
    ellipse(819.5,642,6.1,7.2,-6),ellipse(842,606,2.1,1.9),ellipse(858,612,2,1.8)
  ].join(' ');
  const cranks = 'M665 650 L779 632 L783 648 L781 653 L670 674 Q665 683 655 683 Q639 681 636 669 Q632 657 641 649 Q650 642 660 646Z';
  const sprocket = ellipse(659.5,664,58.8,56.8,-2);
  const sprocketHoles = [
    'M637 624 Q641 618 648 619 L649 636 Q641 634 635 629Z',
    'M660 620 Q666 615 673 620 L687 634 Q678 640 665 637Z',
    'M620 640 Q624 635 630 638 L633 653 Q625 657 617 655Z',
    'M619 677 L632 677 Q635 682 628 691 L622 688Z',
    'M635 699 Q639 693 648 692 L651 708 Q646 712 637 708Z',
    'M663 695 Q670 691 677 693 L693 700 Q688 710 670 711 L664 708Z',
    'M693 680 Q698 676 706 677 L703 692 Q699 696 695 691Z',
    'M694 640 Q701 642 704 650 L692 653Z'
  ].join(' ');
  const hubBolts = ellipse(319,686,10.8,12.1,-8)+' '+ellipse(1177,705,12.8,14.4,-10);
  const hubs = ellipse(319,686,17.6,18.3,-8)+' '+ellipse(1177,705,21,23,-10);
  const chain = [
    // Preserve links passing over the frame/tyres and the metal chainring edge.
    'M311 655 L648 597 Q687 592 710 622 L703 630 Q683 604 650 608 L314 666Z',
    'M306 699 L650 719 Q693 721 711 684 L721 687 Q702 733 649 729 L306 710Z',
    'M711 622 Q728 644 726 669 L716 671 Q719 646 702 629Z'
  ].join(' ');
  const rearRimOuter = ellipse(329,681,188,191,2);
  const rearRimInner = ellipse(329,680,168.5,174.2,2);
  const frontRimOuter = ellipse(1188.5,702,193,195.5,2);
  const frontRimInner = ellipse(1188.5,701,172,176.5,2);
  const rearTyreOuter = ellipse(330,681,232.4,235.5,2);
  const frontTyreOuter = ellipse(1189,702,237.4,239.6,2);
  const wheelOcclusions = [frame,fork,chain,pedals,cranks,sprocket,hubs].join(' ');
  const rims = rearRimOuter+' '+rearRimInner+' '+frontRimOuter+' '+frontRimInner;
  const tyres = rearTyreOuter+' '+rearRimOuter+' '+frontTyreOuter+' '+frontRimOuter;
  // Wall masks sit inside the tread shoulder. Insets keep tread and rims intact.
  const sidewalls = [ellipse(330,681,211,214.5,2),rearRimOuter,ellipse(1189,702,215.2,217.5,2),frontRimOuter].join(' ');
  const barsFour = [
    'M989 59 Q1000 59 1007 74 L1056 264 Q1058 270 1066 270 L1080 270 Q1086 273 1083 283 L1056 284 Q1042 283 1036 268 L994 88 Q992 79 988 77Z',
    'M1074 121 L1090 121 L1100 262 Q1102 271 1096 276 L1083 271Z',
    'M1025 148 L1083 158 Q1094 159 1093 166 Q1092 174 1083 173 L1030 160Z'
  ].join(' ');
  const gripsFour = grips.split(' M1081')[0]+' '+'M1077 93 Q1084 86 1094 90 Q1104 93 1104 101 Q1104 108 1097 114 L1094 122 Q1090 130 1080 127 L1071 124 Q1066 120 1068 112 L1072 103 Q1072 97 1077 93Z';
  const seatPadded = 'M450 351 Q461 344 484 340 L623 313 Q646 308 657 317 Q665 323 668 338 Q669 346 660 350 L606 369 Q580 382 565 393 Q553 402 537 405 Q502 409 474 402 Q449 397 446 384 Q442 372 446 359Z';
  return Object.freeze({
    width:1536,height:1024,
    frame:make(frame,[299,315,820,396],chain+' '+hubBolts+' '+sprocket+' '+cranks),
    fork:make(fork,[1087,426,110,303],ellipse(1177,705,16,17.5,-10)),
    bars:make(bars,[986,55,127,235]),
    grips:make(grips,[889,44,222,55]),
    seat:make(seat,[447,320,218,90]),
    pedals:make(pedals,[777,600,93,65],pedalHoles),
    cranks:make(cranks,[633,631,152,54],ellipse(658,663,11.5,13,-7)),
    sprocket:make(sprocket,[599,605,120,118],sprocketHoles+' '+cranks+' '+chain),
    hubs:make(hubs,[299,665,902,65],hubBolts),
    rims:make(rims,[139,488,1244,412],wheelOcclusions,'evenodd'),
    tyres:make(tyres,[95,443,1335,503],wheelOcclusions,'evenodd'),
    sidewalls:make(sidewalls,[118,466,1288,457],wheelOcclusions,'evenodd'),
    barsFour:make(barsFour,[986,57,119,230]),
    gripsFour:make(gripsFour,[889,44,218,87]),
    seatPadded:make(seatPadded,[443,309,228,102]),
    rearPeg:make('M302 670 Q316 670 329 666 Q339 665 344 672 L346 685 Q347 695 337 701 L311 708 Q297 710 290 702 Q281 695 287 682 Q291 673 302 670Z',[283,664,66,47]),
    frontPeg:make('M1177 683 Q1185 685 1206 690 Q1228 699 1222 717 Q1219 727 1208 729 L1177 718 Q1167 714 1166 699 Q1165 689 1177 683Z',[1163,681,66,51]),
  });
})();
globalThis.JKCrewBikePhotoMasks=JKCrewBikePhotoMasks;
