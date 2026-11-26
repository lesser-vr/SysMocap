// Declarative import defaults for VRMs exported before extras.sysmocap v1.
// Used only to interpret existing assets, never to select an avatar by title.
export const legacyBindings={
    slotTag:'fluffoOutfitSlot',fitTag:'fluffoFitExpression',
    idleTag:'fluffoAnimazeIdle',idleClip:'idle1',settingsKey:'fluffo.live-controls.v1',
    signature:['BipTeethUp','BipLWrist','BipRWrist','Fluffo_TeethAndTongue'],
    rig:{tracking:'extended',neutralEyeOpen:75,mouthAnchor:'BipTeethUp',wristHelpers:{left:'BipLWrist',right:'BipRWrist'},
        mcu:{target:[0,.489,0],offset:[0,.020,.819]}},
    wardrobe:[
        {id:'shirt',minElbowAngle:100,label:'야자수 셔츠',materials:['Sunset palms','Ivory hems','Rose garment button','Deep plum collar','Coral cuff stripe']},
        {id:'badge',label:'가슴 배지',requires:'shirt',materials:['GTA VI official badge']},
        {id:'chain',label:'금목걸이',materials:['Champagne gold']},
        {id:'aviator',label:'에비에이터',materials:['02-aviator']},
        {id:'earCuff',label:'이어커프',materials:['Champagne gold · ear cuff']},
        {id:'goggles',label:'머리 고글',materials:['Fluffo_glasses_Surface']}
    ]
};
