export interface GradePreset {
	id: string;
	name: string;
	bestFor: string;
	filterChain: string;
	raw: string;
}

export const GRADE_PRESETS: GradePreset[] = [
  {
    "id": "Blue Sky - Daytime Scenic",
    "name": "Blue Sky - Daytime Scenic",
    "bestFor": "Daytime outdoor scenes, golden hour footage, bridges, landscapes, coastal views",
    "filterChain": "curves=r='0/0 0.12/0.04 0.5/0.42 0.85/0.82 1/0.9':g='0/0 0.12/0.05 0.5/0.5 0.85/0.9 1/0.98':b='0/0 0.12/0.08 0.5/0.56 0.85/0.94 1/1':m='0/0 0.08/0.02 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=-0.06:gs=-0.02:bs=0.06:rm=-0.04:gm=-0.01:bm=0.04:rh=-0.04:gh=0.0:bh=0.03,eq=contrast=1.28:brightness=0.03:saturation=1.15,unsharp=5:5:0.5",
    "raw": "Blue Sky - Daytime Scenic / Golden Hour Fix\n=============================================\nBest for: Daytime outdoor scenes, golden hour footage, bridges, landscapes, coastal views\n\nFFmpeg filter chain:\ncurves=r='0/0 0.12/0.04 0.5/0.42 0.85/0.82 1/0.9':g='0/0 0.12/0.05 0.5/0.5 0.85/0.9 1/0.98':b='0/0 0.12/0.08 0.5/0.56 0.85/0.94 1/1':m='0/0 0.08/0.02 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=-0.06:gs=-0.02:bs=0.06:rm=-0.04:gm=-0.01:bm=0.04:rh=-0.04:gh=0.0:bh=0.03,eq=contrast=1.28:brightness=0.03:saturation=1.15,unsharp=5:5:0.5\n\nWhat it does:\n- Curves: Red channel CAPPED at 0.9 in highlights \u2014 kills the warm/golden cast\n- Blue channel fully open to 1.0 \u2014 sky goes blue\n- Green channel slightly capped at 0.98 \u2014 removes green cast from log footage\n- Color balance: Cool push across all tones\n- EQ: Moderate contrast, low saturation (1.15) to avoid oversaturation\n\nCRITICAL \u2014 DO NOT use colortemperature filter on golden hour footage:\n- colortemperature on warm footage creates pink/magenta casts\n- Instead, use curves to manually pull down the red channel\n- This preserves actual red objects (like the Golden Gate Bridge) while cooling the sky/water\n- The key insight: curve-based WB correction > colortemperature filter for warm source footage\n"
  },
  {
    "id": "Cool Dramatic - Sunset Ocean",
    "name": "Cool Dramatic - Sunset Ocean",
    "bestFor": "Sunset scenes, ocean overlooks, cliff views, golden hour landscapes where you want cool blue tones",
    "filterChain": "curves=r='0/0 0.05/0.05 0.12/0.1 0.25/0.22 0.5/0.44 0.7/0.66 0.85/0.84 1/0.95':g='0/0 0.05/0.06 0.12/0.12 0.25/0.24 0.5/0.48 0.7/0.7 0.85/0.88 1/0.97':b='0/0 0.05/0.06 0.12/0.12 0.25/0.26 0.5/0.52 0.7/0.76 0.85/0.93 1/1':m='0/0 0.04/0.04 0.1/0.1 0.5/0.54 0.85/0.94 1/1',colorbalance=rs=-0.06:gs=-0.03:bs=0.1:rm=-0.05:gm=-0.02:bm=0.06:rh=-0.01:gh=0.0:bh=0.02,eq=contrast=1.2:brightness=0.08:saturation=1.3,unsharp=5:5:0.5",
    "raw": "Cool Dramatic - Sunset / Ocean Cliff\n======================================\nBest for: Sunset scenes, ocean overlooks, cliff views, golden hour landscapes where you want cool blue tones\n\nFFmpeg filter chain:\ncurves=r='0/0 0.05/0.05 0.12/0.1 0.25/0.22 0.5/0.44 0.7/0.66 0.85/0.84 1/0.95':g='0/0 0.05/0.06 0.12/0.12 0.25/0.24 0.5/0.48 0.7/0.7 0.85/0.88 1/0.97':b='0/0 0.05/0.06 0.12/0.12 0.25/0.26 0.5/0.52 0.7/0.76 0.85/0.93 1/1':m='0/0 0.04/0.04 0.1/0.1 0.5/0.54 0.85/0.94 1/1',colorbalance=rs=-0.06:gs=-0.03:bs=0.1:rm=-0.05:gm=-0.02:bm=0.06:rh=-0.01:gh=0.0:bh=0.02,eq=contrast=1.2:brightness=0.08:saturation=1.3,unsharp=5:5:0.5\n\nWhat it does:\n- Curves: Many control points for smooth tonal transitions, red capped, blue fully open\n- Shadows are LIFTED (not crushed) \u2014 you can see grass, rocks, people on cliffs\n- Color balance: Strong blue push in shadows/mids\n- EQ: Lower contrast (1.2) and higher brightness (0.08) to keep shadow detail\n- Saturation 1.3 brings out greens in vegetation\n\nNotes:\n- This grade keeps shadow detail visible \u2014 grass, rocks, people won't become silhouettes\n- If you want more dramatic/crushed shadows, reduce brightness to 0.01 and increase contrast to 1.4\n- The sun/reflection naturally stays warm because it's pure white/overexposed \u2014 the blue only affects mids and shadows\n"
  },
  {
    "id": "Deep Ocean Blue - Aquarium",
    "name": "Deep Ocean Blue - Aquarium",
    "bestFor": "Aquarium scenes, blue-lit environments, underwater projections, immersive exhibits",
    "filterChain": "curves=r='0/0 0.12/0.0 0.2/0.08 0.5/0.5 1/1':g='0/0 0.12/0.0 0.2/0.08 0.5/0.5 1/1':b='0/0 0.12/0.0 0.2/0.1 0.5/0.58 1/1':m='0/0 0.1/0.0 0.2/0.08 0.4/0.35 0.6/0.65 0.9/0.95 1/1',colorbalance=rs=-0.08:gs=-0.04:bs=0.05:rm=-0.1:gm=-0.04:bm=0.15:rh=-0.08:gh=-0.02:bh=0.12,eq=contrast=1.35:brightness=0.02:saturation=1.4,colortemperature=temperature=4000,unsharp=5:5:0.8",
    "raw": "Deep Ocean Blue - Aquarium / Blue Ambient Light\n=================================================\nBest for: Aquarium scenes, blue-lit environments, underwater projections, immersive exhibits\n\nFFmpeg filter chain:\ncurves=r='0/0 0.12/0.0 0.2/0.08 0.5/0.5 1/1':g='0/0 0.12/0.0 0.2/0.08 0.5/0.5 1/1':b='0/0 0.12/0.0 0.2/0.1 0.5/0.58 1/1':m='0/0 0.1/0.0 0.2/0.08 0.4/0.35 0.6/0.65 0.9/0.95 1/1',colorbalance=rs=-0.08:gs=-0.04:bs=0.05:rm=-0.1:gm=-0.04:bm=0.15:rh=-0.08:gh=-0.02:bh=0.12,eq=contrast=1.35:brightness=0.02:saturation=1.4,colortemperature=temperature=4000,unsharp=5:5:0.8\n\nWhat it does:\n- Curves: Crushes blacks to true black (key for silhouettes), blue channel lifted in mids\n- Color balance: Heavy blue push in mids/highlights, red/green suppressed\n- EQ: Strong contrast, slight brightness lift, high saturation for vivid blue\n- Color temp: Cooled to 4000K for blue push\n- Unsharp: Strong sharpening for detail in projection/glass\n\nNotes:\n- True blacks preserved \u2014 silhouettes stay black, not blue\n- Works best when there's a strong blue ambient light source\n- For underwater-only shots, increase contrast to 1.5 and reduce brightness to -0.03\n"
  },
  {
    "id": "Deep Teal - Ocean Water",
    "name": "Deep Teal - Ocean Water",
    "bestFor": "Ocean scenes, boat footage, parasailing, water sports, coastal shots",
    "filterChain": "colortemperature=temperature=4600,colorbalance=rs=-0.08:gs=-0.03:bs=0.1:rm=-0.04:gm=0.0:bm=0.06:rh=-0.01:gh=0.0:bh=0.02,curves=r='0/0 0.15/0.05 0.5/0.48 0.85/0.9 1/1':g='0/0 0.15/0.06 0.5/0.5 0.85/0.9 1/1':b='0/0 0.15/0.09 0.5/0.56 0.85/0.93 1/1':m='0/0 0.1/0.04 0.5/0.52 0.85/0.94 1/1',eq=contrast=1.35:brightness=0.03:saturation=1.3,unsharp=5:5:0.6",
    "raw": "Deep Teal - Ocean / Water / Boat\n==================================\nBest for: Ocean scenes, boat footage, parasailing, water sports, coastal shots\n\nFFmpeg filter chain (boat/deck shots):\ncolortemperature=temperature=4600,colorbalance=rs=-0.08:gs=-0.03:bs=0.1:rm=-0.04:gm=0.0:bm=0.06:rh=-0.01:gh=0.0:bh=0.02,curves=r='0/0 0.15/0.05 0.5/0.48 0.85/0.9 1/1':g='0/0 0.15/0.06 0.5/0.5 0.85/0.9 1/1':b='0/0 0.15/0.09 0.5/0.56 0.85/0.93 1/1':m='0/0 0.1/0.04 0.5/0.52 0.85/0.94 1/1',eq=contrast=1.35:brightness=0.03:saturation=1.3,unsharp=5:5:0.6\n\nFFmpeg filter chain (aerial/water-only - fixes pink foam):\ncolortemperature=temperature=4600,colorbalance=rs=-0.08:gs=-0.03:bs=0.1:rm=-0.04:gm=0.0:bm=0.06:rh=-0.06:gh=0.02:bh=0.04,curves=r='0/0 0.15/0.05 0.5/0.46 0.85/0.85 1/0.94':g='0/0 0.15/0.06 0.5/0.5 0.85/0.9 1/1':b='0/0 0.15/0.09 0.5/0.56 0.85/0.93 1/1':m='0/0 0.1/0.04 0.5/0.52 0.85/0.94 1/1',eq=contrast=1.35:brightness=0.03:saturation=1.3,unsharp=5:5:0.6\n\nWhat it does:\n- Color temp: Cooled to 4600K for teal water\n- Color balance: Blue push in shadows/mids, neutral highlights\n- Curves: Blue channel lifted, red suppressed for teal ocean\n- EQ: Good contrast, moderate saturation for vibrant but not overdone\n\nIMPORTANT - Pink foam fix:\n- White water foam/wake can turn pink when cooling the image\n- The aerial variant pulls red out of highlights aggressively (rh=-0.06, red curve capped at 0.94)\n- Use the aerial variant for any shot with lots of white water/foam/spray\n"
  },
  {
    "id": "Neon Carnival - Night Fair",
    "name": "Neon Carnival - Night Fair",
    "bestFor": "Carnivals, fairs, amusement parks, night markets, any night scene with colorful lights",
    "filterChain": "curves=r='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.92 1/1':g='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.9 1/1':b='0/0 0.08/0.0 0.2/0.12 0.5/0.54 0.85/0.93 1/1':m='0/0 0.06/0.0 0.18/0.08 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=-0.02:gs=-0.02:bs=0.04:rm=-0.01:gm=-0.01:bm=0.03:rh=0.0:gh=0.0:bh=0.02,eq=contrast=1.3:brightness=0.06:saturation=1.35,unsharp=5:5:0.6",
    "raw": "Neon Carnival - Night Fair / Amusement Park\n=============================================\nBest for: Carnivals, fairs, amusement parks, night markets, any night scene with colorful lights\n\nFFmpeg filter chain (standard):\ncurves=r='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.92 1/1':g='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.9 1/1':b='0/0 0.08/0.0 0.2/0.12 0.5/0.54 0.85/0.93 1/1':m='0/0 0.06/0.0 0.18/0.08 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=-0.02:gs=-0.02:bs=0.04:rm=-0.01:gm=-0.01:bm=0.03:rh=0.0:gh=0.0:bh=0.02,eq=contrast=1.3:brightness=0.06:saturation=1.35,unsharp=5:5:0.6\n\nFFmpeg filter chain (darker - for bright/overlit scenes):\ncurves=r='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.92 1/1':g='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.9 1/1':b='0/0 0.08/0.0 0.2/0.12 0.5/0.54 0.85/0.93 1/1':m='0/0 0.06/0.0 0.18/0.08 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=-0.02:gs=-0.02:bs=0.04:rm=-0.01:gm=-0.01:bm=0.03:rh=0.0:gh=0.0:bh=0.02,eq=contrast=1.35:brightness=-0.02:saturation=1.35,unsharp=5:5:0.6\n\nNotes:\n- Same base as Neon Rain but this is the reference for carnival/fair scenes\n- Use the darker variant for aerial/overhead shots of bright fairgrounds\n- The standard variant with brightness=0.06 works for ground-level shots\n- All ride colors (reds, blues, pinks, yellows) pop naturally\n"
  },
  {
    "id": "Neon Rain - Night City",
    "name": "Neon Rain - Night City",
    "bestFor": "Night city scenes, wet streets, neon reflections, urban night footage",
    "filterChain": "curves=r='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.92 1/1':g='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.9 1/1':b='0/0 0.08/0.0 0.2/0.12 0.5/0.54 0.85/0.93 1/1':m='0/0 0.06/0.0 0.18/0.08 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=-0.02:gs=-0.02:bs=0.04:rm=-0.01:gm=-0.01:bm=0.03:rh=0.0:gh=0.0:bh=0.02,eq=contrast=1.3:brightness=0.06:saturation=1.35,unsharp=5:5:0.6",
    "raw": "Neon Rain - Night City Color Grade\n===================================\nBest for: Night city scenes, wet streets, neon reflections, urban night footage\n\nFFmpeg filter chain:\ncurves=r='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.92 1/1':g='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.9 1/1':b='0/0 0.08/0.0 0.2/0.12 0.5/0.54 0.85/0.93 1/1':m='0/0 0.06/0.0 0.18/0.08 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=-0.02:gs=-0.02:bs=0.04:rm=-0.01:gm=-0.01:bm=0.03:rh=0.0:gh=0.0:bh=0.02,eq=contrast=1.3:brightness=0.06:saturation=1.35,unsharp=5:5:0.6\n\nUsage example:\nffmpeg -i input.MOV -vf \"curves=r='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.92 1/1':g='0/0 0.08/0.0 0.2/0.1 0.5/0.5 0.85/0.9 1/1':b='0/0 0.08/0.0 0.2/0.12 0.5/0.54 0.85/0.93 1/1':m='0/0 0.06/0.0 0.18/0.08 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=-0.02:gs=-0.02:bs=0.04:rm=-0.01:gm=-0.01:bm=0.03:rh=0.0:gh=0.0:bh=0.02,eq=contrast=1.3:brightness=0.06:saturation=1.35,unsharp=5:5:0.6\" -c:v prores_ks -profile:v 1 -c:a copy output.MOV\n\nWhat it does:\n- Curves: Crushes blacks, slight blue lift in shadows/mids, clean highlights\n- Color balance: Subtle cool blue shift across all tones\n- EQ: Moderate contrast boost, brightness lift for night scenes, saturation boost to make neon/light reflections pop\n- Unsharp: Light sharpening for detail on wet surfaces\n\nNotes:\n- Works best on flat/log profile footage\n- Colorful light sources (neon signs, traffic lights, storefronts) will pop against the cool base\n- Wet surfaces amplify the effect with reflections\n- For drier scenes, consider reducing saturation from 1.35 to 1.2\n"
  },
  {
    "id": "Purple Punch - DJ Party",
    "name": "Purple Punch - DJ Party",
    "bestFor": "Indoor parties, DJ sets, club scenes, laser/light shows, purple/pink ambient lighting",
    "filterChain": "curves=r='0/0 0.1/0.03 0.5/0.48 0.85/0.9 1/1':g='0/0 0.1/0.02 0.5/0.42 0.85/0.84 1/1':b='0/0 0.1/0.04 0.5/0.52 0.85/0.92 1/1':m='0/0 0.08/0.02 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=0.04:gs=-0.04:bs=0.06:rm=0.03:gm=-0.03:bm=0.04:rh=0.02:gh=-0.02:bh=0.03,eq=contrast=1.35:brightness=0.04:saturation=1.4,unsharp=5:5:0.6",
    "raw": "Purple Punch - DJ / Party / Club\n==================================\nBest for: Indoor parties, DJ sets, club scenes, laser/light shows, purple/pink ambient lighting\n\nFFmpeg filter chain:\ncurves=r='0/0 0.1/0.03 0.5/0.48 0.85/0.9 1/1':g='0/0 0.1/0.02 0.5/0.42 0.85/0.84 1/1':b='0/0 0.1/0.04 0.5/0.52 0.85/0.92 1/1':m='0/0 0.08/0.02 0.5/0.52 0.85/0.94 1/1',colorbalance=rs=0.04:gs=-0.04:bs=0.06:rm=0.03:gm=-0.03:bm=0.04:rh=0.02:gh=-0.02:bh=0.03,eq=contrast=1.35:brightness=0.04:saturation=1.4,unsharp=5:5:0.6\n\nWhat it does:\n- Curves: Green channel suppressed (0.84 max) for purple/magenta lean, blue lifted\n- Color balance: Red+blue pushed (=purple), green pulled across all tones\n- EQ: Strong contrast to separate people from haze, high saturation for vivid lights\n- Unsharp: Good sharpening to cut through smoke/haze\n\nNotes:\n- Works with purple, pink, and blue ambient lighting\n- The green suppression is what makes it purple rather than blue\n- For redder club lighting, increase rs/rm values and decrease bs/bm slightly\n- Smoke/haze machines add atmosphere \u2014 the contrast boost helps cut through it\n"
  },
  {
    "id": "Steel Blue - Night City BW",
    "name": "Steel Blue - Night City BW",
    "bestFor": "Night city scenes, bridges, skylines, moody urban, silhouettes",
    "filterChain": "colortemperature=temperature=4500,curves=m='0/0 0.08/0.0 0.18/0.04 0.45/0.48 0.6/0.65 0.85/0.92 1/1',eq=contrast=1.45:brightness=0.05:saturation=0.0,colorbalance=rs=-0.06:gs=-0.02:bs=0.1:rm=-0.04:gm=-0.01:bm=0.07:rh=-0.01:gh=0.0:bh=0.03,unsharp=5:5:0.7",
    "raw": "Steel Blue - Night City Black & White\n======================================\nBest for: Night city scenes, bridges, skylines, moody urban, silhouettes\n\nFFmpeg filter chain (standard):\ncolortemperature=temperature=4500,curves=m='0/0 0.08/0.0 0.18/0.04 0.45/0.48 0.6/0.65 0.85/0.92 1/1',eq=contrast=1.45:brightness=0.05:saturation=0.0,colorbalance=rs=-0.06:gs=-0.02:bs=0.1:rm=-0.04:gm=-0.01:bm=0.07:rh=-0.01:gh=0.0:bh=0.03,unsharp=5:5:0.7\n\nFFmpeg filter chain (brighter - for darker source footage):\ncolortemperature=temperature=4500,curves=m='0/0 0.06/0.03 0.15/0.1 0.4/0.45 0.6/0.66 0.85/0.92 1/1',eq=contrast=1.3:brightness=0.1:saturation=0.0,colorbalance=rs=-0.06:gs=-0.02:bs=0.1:rm=-0.04:gm=-0.01:bm=0.07:rh=-0.01:gh=0.0:bh=0.03,unsharp=5:5:0.6\n\nWhat it does:\n- Color temp: Cool base at 4500K\n- Curves: Crush blacks, good midtone contrast, clean highlights\n- EQ: Saturation=0 makes it BW, then colorbalance adds blue tint back\n- Color balance: Blue tint layered ON TOP of BW conversion (key technique)\n- The trick: desaturate FIRST, then tint \u2014 this avoids color cast problems\n\nNotes:\n- Use the brighter variant for footage that's already very dark (silhouettes, underexposed)\n- The BW-then-tint technique avoids the pink/magenta problem that colortemperature alone causes\n- Works beautifully for bridge lights, city skylines, street scenes at night\n"
  }
] as const satisfies GradePreset[];

export function listGradePresets(): GradePreset[] {
	return [...GRADE_PRESETS];
}

export function findGradePreset({ name }: { name: string }): GradePreset {
	const grades = listGradePresets();
	const matches = grades.filter((g) => g.name.toLowerCase().includes(name.toLowerCase()));
	if (matches.length === 0) {
		throw new Error(`Grade '${name}' not found. Available: ${grades.map((g) => g.name).join(", ")}`);
	}
	if (matches.length > 1) {
		throw new Error(`Ambiguous grade '${name}'. Matches: ${matches.map((g) => g.name).join(", ")}`);
	}
	return matches[0];
}
