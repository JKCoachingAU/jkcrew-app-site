// Clockwise from up. Mobile trick-stick layout; original animations live in rig.js.
// Three sets, picked with the T1 / T2 / T3 buttons stacked above PEDAL (sticky: the set stays
// until another is tapped; T on a keyboard cycles them).
export const BASIC=['tabletop','barspin','tailwhip','cancan','turndown','toboggan','nohander','superman'];
export const ADVANCED_STICK=['onehandtable','bikeflip','decade','nofootcancan','kickout','xup','suicide','cliffhanger'];
export const TIER3=['indy','cannonball','frontbikeflip','onefootxup','pendulum','nofootcanonehander','cancantyregrab','nacnac'];
export const TIERS=[BASIC,ADVANCED_STICK,TIER3];
export const TIER_LABELS=[
 ['TABLE','BAR','WHIP','CAN-CAN','TURN','TOBOGGAN','NO HAND','SUPERMAN'],
 ['1H TABLE','BIKEFLIP','DECADE','NO FOOT','KICKOUT','X-UP','SUICIDE','CLIFF'],
 ['INDY','CANNON','FR BIKE','1FT X-UP','PENDULUM','NF CAN 1H','CC TYRE','NAC NAC']
];
export const ARROWS=['↑','↗','→','↘','↓','↙','←','↖'];
export function sector(dx,dy){return (Math.round(Math.atan2(dx,-dy)/(Math.PI/4))+8)%8;}
