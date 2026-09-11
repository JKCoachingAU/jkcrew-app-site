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
  // Version 2 hardware; geometry stays in the same registered photo space.
  const seatpost = 'M557 393 L576 384 L591 422 L571 429Z M565 429 L595 421 Q603 417 607 423 L607 431 L569 443 Q564 444 563 438Z';
  const stem = 'M1039 284 L1067 278 Q1081 288 1093 280 L1095 264 L1104 263 L1110 292 L1050 309 Q1039 311 1036 302 L1033 292 Q1033 287 1039 284Z';
  const headset = 'M1048 310 Q1062 306 1086 302 L1090 308 L1093 319 L1051 329 L1048 321Z M1080 419 L1114 410 Q1120 411 1123 421 L1118 426 L1084 435 L1079 428Z';
  const rearPegV2 = 'M274 680 L311 669 Q326 666 332 678 L335 692 Q331 706 319 709 L283 716 Q266 720 260 706 Q254 690 274 680Z';
  const frontPegV2 = 'M1144 707 L1173 687 Q1188 683 1197 695 Q1204 706 1193 719 L1166 737 Q1146 744 1137 733 Q1127 719 1144 707Z';
  const rearFarPeg = 'M218 661 L282 657 L310 664 L309 680 L235 690 Q218 692 215 682 Q212 669 218 661Z';
  const frontFarPeg = 'M1205 680 L1283 679 Q1296 684 1295 699 Q1297 710 1285 715 L1210 712Z';
  const pegHoles = [ellipse(275.5,698.5,12,13.5,-15),ellipse(1151,721,12.4,13.9,-15)].join(' ');
  const spokeWindow = [ellipse(329,680,160,165.6,2),ellipse(1188.5,701,164,168.1,2)].join(' ');
  const nippleWindow = [rearRimInner,ellipse(329,680,160,165.6,2),frontRimInner,ellipse(1188.5,701,164,168.1,2)].join(' ');
  const metalPedal = 'M782 620 L837 604 Q858 600 878 609 L900 623 L901 651 Q895 659 882 660 L812 676 Q797 678 785 667 L779 659 L779 634Z';
  const metalPedalHoles = 'M801 625 L822 619 L830 628 L810 634Z M839 615 Q853 609 866 615 L874 625 L846 631Z M829 652 L846 646 L849 657 L830 664Z M862 643 L882 638 L888 646 L864 653Z '+ellipse(790,648,6,10,-6);
  // Sparse registered cutouts, not a rectangular overlay over the painted frame.
  const rearBrakeBody = 'M944 95 Q953 82 968 85 L977 75 L988 78 L996 90 L1008 94 L1005 101 L984 99 Q963 91 955 106 Q950 113 946 107Z M409 530 L424 520 L446 516 L467 490 L493 470 Q500 465 506 473 L511 486 L505 496 L499 495 L471 531 L444 558 Q436 566 427 562 L418 558 L415 548Z';
  const rearBrakeCable = 'M1003 96 L1017 100 L1038.5 110 L1054 120 L1067.5 130 L1079.5 140 L1091 150 L1101 160 L1110.5 170 L1119 180 L1127 190 L1134.5 200 L1141 210 L1146.5 220 L1151.5 230 L1155.5 240 L1158.5 250 L1161.5 260 L1163.5 270 L1163.5 280 L1162 290 L1160 300 L1155.5 310 L1151 320 L1144 330 L1133.5 340 L1119 350 L1103 357 M1057 364 L700 454 M689 456 L638 465 M570 458 Q542 456 519 461 L503 470';
  const frontBrakeBody = 'M1101 94 Q1105 92 1110 99 L1117 104 L1115 111 L1105 106Z M1145 409 L1155 409 L1158 433 Q1170 439 1172 455 L1167 463 L1173 504 L1193 509 L1195 522 L1182 528 L1179 539 L1169 546 L1160 543 L1156 531 L1145 529 L1137 518 L1139 508 L1154 505 L1142 468 L1136 446 Q1137 437 1145 436Z';
  const frontBrakeCable = 'M1113 105 L1118.5 110 L1127.5 120 L1135.5 130 L1141.5 140 L1147.5 150 L1151.5 160 L1155.5 170 L1158.5 180 L1161.5 190 L1163.5 200 L1164.5 210 L1166 220 L1166.5 230 L1167.5 240 L1167.5 250 L1167.5 270 L1166 290 L1164.5 300 L1163.5 310 L1162.5 320 L1161.5 330 L1159.5 340 L1158.5 350 L1156.5 360 L1150 408';
  // LHD keeps this camera; the drivetrain is physically behind the frame.
  const lhdFrame=frame+' '+[
    'M606 462 L663 625 Q670 639 667 651 L647 660 Q637 649 632 635 L578 477Z',
    'M660 643 L707 610 L722 635 L682 667 Q669 675 658 663Z',
    'M594 654 L645 650 L650 672 L596 680Z',
    ellipse(658,664,29,29,-7)
  ].join(' ');
  const lhdCranks='M672 642 L779 632 L783 648 L781 653 L683 676 Q677 690 659 690 Q640 690 632 676 Q624 662 635 647 Q648 634 662 639Z';
  const lhdSprocket=ellipse(640,651,42,48,-2);
  const lhdChain=[
    'M343 650 L489 625 L491 635 L350 661Z',
    'M557 610 L625 598 L628 609 L558 621Z',
    'M656 600 Q675 602 685 623 L678 630 Q669 611 655 610Z',
    'M311 699 L495 697 L496 708 L313 714Z',
    'M563 692 L641 680 L646 690 L565 704Z'
  ].join(' ');
  const lhdSprocketHoles='M613 623 L623 620 L627 635 L612 640 L608 636Z M606 645 L622 647 L624 657 L607 662Z M610 674 L620 677 L626 687 L616 691Z';
  const lhdWheelOcclusions=[lhdFrame,fork,lhdChain,pedals,lhdCranks,lhdSprocket,hubs].join(' ');
  return Object.freeze({
    width:1536,height:1024,
    lhdFrame:make(lhdFrame,[299,315,820,396],hubBolts+' '+lhdCranks),
    lhdCranks:make(lhdCranks,[627,631,158,61],ellipse(658,663,11.5,13,-7)),
    lhdSprocket:make(lhdSprocket,[595,600,89,101],lhdSprocketHoles+' '+lhdFrame+' '+lhdCranks+' '+lhdChain),
    lhdChain:make(lhdChain,[308,595,380,122]),
    lhdSpokes:Object.freeze({...make(spokeWindow,[166,513,1190,361],lhdWheelOcclusions),detail:true}),
    lhdNipples:Object.freeze({...make(nippleWindow,[155,503,1209,381],lhdWheelOcclusions,'evenodd'),detail:true}),
    lhdRims:make(rims,[139,488,1244,412],lhdWheelOcclusions,'evenodd'),
    lhdTyres:make(tyres,[95,443,1335,503],lhdWheelOcclusions,'evenodd'),
    lhdSidewalls:make(sidewalls,[118,466,1288,457],lhdWheelOcclusions,'evenodd'),
    // Foreground-only silhouettes retain photographed bearings and rail clamps;
    // recolour exclusions remain separate from the bike's transparency.
    chain:make(chain,[301,594,430,141]),
    seatRails:make('M535 394 Q549 385 564 382 L581 382 L583 391 L563 395 L548 403 Q540 403 535 399Z',[532,379,54,27]),
    seatpost:make(seatpost,[555,382,55,64],ellipse(600,426,3.2,3.1)),
    stem:make(stem,[1031,260,82,53],ellipse(1040.5,292,4.2,4.8)+' '+ellipse(1045,304,3.8,4.1)),
    headset:make(headset,[1046,300,80,139]),
    spokes:Object.freeze({...make(spokeWindow,[166,513,1190,361],wheelOcclusions),detail:true}),
    nipples:Object.freeze({...make(nippleWindow,[155,503,1209,381],wheelOcclusions,'evenodd'),detail:true}),
    rearPegV2:make(rearPegV2,[253,666,86,55],pegHoles),
    frontPegV2:make(frontPegV2,[1126,681,80,65],pegHoles),
    rearFarPeg:make(rearFarPeg,[209,653,105,42]),
    frontFarPeg:make(frontFarPeg,[1200,675,101,43]),
    plasticPedal:make(metalPedal,[776,598,128,82],metalPedalHoles),
    metalPedal:make('M783 619 L850 601 Q860 598 867 606 L900 621 L903 646 Q906 655 895 661 L822 678 Q809 680 800 673 L784 659 L780 645Z',[777,596,130,86],'M802 623 L822 618 L833 627 L815 633Z M837 615 L853 610 L873 622 L861 630 L845 628Z M826 651 L849 646 L851 659 L829 666Z M865 643 L887 639 L895 644 L888 653 L866 659Z '+ellipse(788,644,4.5,9,-10)),
    stemTop:make('M1030 275 L1064 265 Q1076 284 1094 273 L1095 255 L1106 253 L1114 290 L1043 307 Q1032 307 1029 296 L1026 282Z',[1023,250,94,60],ellipse(1033,281,4.1,4.5)+' '+ellipse(1037,295,4.1,4.4)),
    stemFront:make('M1027 269 L1063 260 Q1077 286 1093 276 L1094 253 L1109 250 Q1116 252 1119 264 L1120 286 Q1118 291 1110 293 L1038 307 Q1027 307 1025 295 L1021 280 Q1020 273 1027 269Z',[1018,247,105,63],ellipse(1031,283,5.7,6.3)+' '+ellipse(1108,263,5.5,6.3)+' '+ellipse(1036,297,2.2,2.4)),
    rearBrake:Object.freeze({...make(rearBrakeBody,[407,74,771,493]),strokePath:rearBrakeCable,strokeWidth:5.4}),
    frontBrake:Object.freeze({...make(frontBrakeBody,[1099,91,100,457]),strokePath:frontBrakeCable,strokeWidth:5.4,leverPath:frontBrakeBody.split(' M1145')[0],caliperPath:'M1145'+frontBrakeBody.split(' M1145')[1],strokePathFour:'M1141.5 140'+frontBrakeCable.split('L1141.5 140')[1]}),
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
