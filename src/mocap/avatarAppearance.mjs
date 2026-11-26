/** Optional appearance bindings authored on glTF materials, shared by local and broadcast views. */
function eyeMaterial(base) {
    const eye = base.clone();
    eye.roughness = .19;
    eye.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
            // Keep the painted iris and pupil legible under the studio fill.
            // The paired catchlights supply the corneal reflection.
            outgoingLight = mix(totalDiffuse, diffuseColor.rgb, .55) + totalEmissiveRadiance;
            float peak = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
            float chroma = peak - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
            float iris = smoothstep(.30, .75, chroma / max(peak, .001)) * smoothstep(.02, .12, peak);
            outgoingLight *= 1.0 + iris;
            float glint = 1.0 - smoothstep(.061, .116, length(normal.xy - vec2(-.18, -.065)));
            float smallGlint = 1.0 - smoothstep(.043, .088, length(normal.xy - vec2(.115, -.058)));
            outgoingLight += vec3(1.9) * (glint + smallGlint);
            #include <opaque_fragment>`);
    };
    eye.customProgramCacheKey = () => 'studio-eye-2';
    return eye;
}

const furLevels = {off:0, face:18, standard:18, high:22};
function coatLayers(tone, attribute) {
    const layers = tone?.layers;
    if (attribute?.itemSize !== 4 || !Array.isArray(layers) || !layers.length || layers.length > 4) return null;
    const gains = [], ranges = [];
    for (const layer of layers) {
        if (!Array.isArray(layer?.gain) || layer.gain.length !== 3 ||
            !layer.gain.every(v => Number.isFinite(v) && v > 0 && v <= 4)) return null;
        const range = layer.lightRange ?? [-1, -.5];
        if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) return null;
        gains.push(...layer.gain.map(Math.log2));
        ranges.push(...range);
    }
    return {count: layers.length, gains: new Float32Array(gains), ranges: new Float32Array(ranges)};
}

function applyCoatTone(shader, tone, groom, layers) {
    shader.uniforms.whiteGain = {value: tone.whiteGain};
    shader.uniforms.warmGain = {value: tone.warmGain};
    shader.fragmentShader = 'uniform float whiteGain; uniform vec3 warmGain;\n' +
        shader.fragmentShader.replace('#include <map_fragment>', `
            #include <map_fragment>
            float red = diffuseColor.r;
            float warmth = smoothstep(.12,.55,(red - diffuseColor.b) / max(red,.001));
            float white = smoothstep(.10,.52,min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b)));
            vec3 gain = mix(vec3(mix(1.0,whiteGain,white)),warmGain,warmth);
            diffuseColor.rgb *= mix(vec3(1.0),gain,${groom?'1.0 - vGroom':'1.0'});
        `);
    if (!layers) return;
    shader.uniforms.coatLogGain = {value: layers.gains};
    shader.uniforms.coatLightRange = {value: layers.ranges};
    shader.vertexShader = 'attribute vec4 _coat_tone; varying vec4 vCoatTone;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoatTone = _coat_tone;');
    shader.fragmentShader = `varying vec4 vCoatTone;
        uniform vec3 coatLogGain[${layers.count}];
        uniform vec2 coatLightRange[${layers.count}];\n` +
        shader.fragmentShader.replace('#include <opaque_fragment>', `
            float lit = dot(outgoingLight, vec3(.2126,.7152,.0722));
            vec3 logGain = vec3(0.0);
            for (int i = 0; i < ${layers.count}; ++i) {
                logGain += vCoatTone[i] * smoothstep(coatLightRange[i].x,coatLightRange[i].y,lit) * coatLogGain[i];
            }
            outgoingLight *= exp2(logGain);
            #include <opaque_fragment>`);
}

function occludedMaterial(base, binding, expressions) {
    const material = base.clone();
    const open = {value: 0}, tongue = {value: 0};
    const maxWeight = names => names.reduce((v, name) => Math.max(v, expressions.getValue(name) || 0), 0);
    material.onBeforeRender = () => {
        open.value = maxWeight(binding.open);
        tongue.value = maxWeight(binding.tongue);
    };
    material.onBeforeCompile = shader => {
        const recess = Number.isFinite(binding.recessedTissueLight) ? Math.min(1,Math.max(0,binding.recessedTissueLight)) : 1;
        Object.assign(shader.uniforms, {openWeight: open, tongueWeight: tongue, recessedLight: {value: recess}});
        shader.fragmentShader = 'uniform float openWeight, tongueWeight, recessedLight;\n' +
            shader.fragmentShader.replace('#include <aomap_fragment>', `
                vec3 cavity = texture2D(aoMap,vAoMapUv).rgb;
                float exposure = clamp(mix(cavity.r,cavity.g,openWeight) + 2.0*cavity.b*tongueWeight,0.0,1.0);
                float tissue = smoothstep(.12,.72,(diffuseColor.r-diffuseColor.g)/max(.001,diffuseColor.r));
                exposure *= mix(1.0,exposure * mix(recessedLight,1.0,tongueWeight),tissue);
                reflectedLight.directDiffuse *= exposure;
                reflectedLight.indirectDiffuse *= exposure;
                reflectedLight.directSpecular *= exposure;
                reflectedLight.indirectSpecular *= exposure;
            `);
    };
    material.customProgramCacheKey = () => 'avatar-pose-occlusion-1';
    return material;
}
function applyGroomShader(shader, groom) {
    // A model-authored vertex mask blends the regional treatment into the surrounding coat.
    const bounded=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
    shader.uniforms.groomLight = {value:bounded(groom.highlightLift,0,1,0)};
    shader.uniforms.groomLength = {value:bounded(groom.lengthScale,.1,2,1)};
    shader.uniforms.groomCoverage = {value:bounded(groom.coverage,.2,4,1)};
    shader.vertexShader = 'attribute float _fur_groom; varying float vGroom; uniform float groomLength;\n'
        + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroom = _fur_groom;');
    shader.fragmentShader = 'varying float vGroom; uniform float groomLight, groomCoverage;\n'
        + shader.fragmentShader.replace('#include <opaque_fragment>', `
            float coatLuma = dot(outgoingLight, vec3(.2126,.7152,.0722));
            float lifted = 1.04 * (1.0 - exp(-6.6 * max(0.0, coatLuma - .030)));
            vec3 tint = mix(vec3(1.0,.99,.99), outgoingLight / max(coatLuma,.01),
                            .6 * (1.0 - smoothstep(.12,.38,coatLuma)));
            outgoingLight += tint * max(0.0, lifted-coatLuma) * groomLight * vGroom;
            #include <opaque_fragment>`);
}
function shellMaterial(base, spec, mask, groom, tone, layers) {
    const fur = base.clone();
    fur.side = 0; // FrontSide
    fur.transparent = true;
    fur.depthWrite = false;
    fur.alphaTest = 0;
    const layer = {value: 0}, density = {value: 1};
    fur.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, {furLayer: layer, furLength: {value: spec.length},
            furBend: {value: spec.bend}, furMask: {value: mask}, furDensity: density,
            furMaskBias: {value: Number.isFinite(spec.maskBias) ? Math.max(-4,Math.min(2,spec.maskBias)) : 0}});
        shader.vertexShader = `
            attribute vec4 color_1;
            uniform float furLayer, furLength, furBend;
            varying vec2 furUv;
            varying float furExtent;
        ` + shader.vertexShader.replace('#include <uv_vertex>', `
            #include <uv_vertex>
            furExtent = color_1.a;
            vec2 drift = (2.0 * color_1.rg - 1.0) * furBend * furExtent * pow(furLayer, 3.0);
            furUv = uv + drift;
            #ifdef USE_MAP
                vMapUv += drift;
            #endif`).replace('#include <morphtarget_vertex>', `
            #include <morphtarget_vertex>
            transformed += normal * furLength * furExtent * furLayer ${groom?'* mix(1.0,groomLength,vGroom)':''};`);
        shader.fragmentShader = `
            uniform sampler2D furMask;
            uniform float furLayer, furDensity, furMaskBias;
            varying vec2 furUv;
            varying float furExtent;
        ` + shader.fragmentShader.replace('#include <map_fragment>', `
            #include <map_fragment>
            vec4 mask = texture2D(furMask, furUv, furMaskBias);
            float coat = sqrt(mask.a) - furLayer;
            if (coat < .05 || furExtent < .01) discard;
            diffuseColor.a *= coat * mask.g;
            #ifndef FLAT_SHADED
                float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
                // Add samples across the silhouette without rebuilding a thick coat over frontal detail.
                float front = smoothstep(.22, .83, facing);
                float clarity = smoothstep(.30, .60, facing);
                ${groom?'front *= (1.0 - .55*vGroom); clarity *= (1.0 - .55*vGroom);':''}
                diffuseColor.a *= mix(1.0, .10, clarity);
                diffuseColor.a = 1.0 - pow(1.0 - clamp(diffuseColor.a, 0.0, 1.0), mix(1.0, furDensity, front));
            #endif
            ${groom?'diffuseColor.a = 1.0 - pow(max(0.0,1.0-diffuseColor.a),mix(1.0,groomCoverage,vGroom));':''}
            if (diffuseColor.a < .005) discard;`);
        if(groom)applyGroomShader(shader,groom);
        if(tone)applyCoatTone(shader,tone,groom,layers);
    };
    fur.customProgramCacheKey = () => 'avatar-fur-5-' + Boolean(groom) + '-' + Boolean(tone) + '-' + (layers?.count ?? 0);
    return {fur, layer, density};
}

export function mountAvatarAppearance(THREE, scene, model, parser, tuning, expressions) {
    const {values} = tuning;
    const fill = new THREE.HemisphereLight(0xfff7ee, 0xd8d6dc);
    const bounce = new THREE.DirectionalLight(0xfff1de);
    bounce.position.set(-1, .5, .9);
    scene.add(fill, bounce);
    const preferred = parser?.json?.asset?.extras?.sysmocapLightPreset;
    const eyes = [], coats = [], groomedBases = [];
    function refresh() {
        const soft = (values.lightPreset === 'auto' ? preferred : values.lightPreset) === 'soft';
        fill.visible = bounce.visible = soft;
        fill.intensity = 1.85 * values.light;
        bounce.intensity = 1.3 * values.light;
        for (const {mesh, base, studio} of eyes) mesh.material = soft ? studio : base;
        const count = furLevels[values.furQuality] ?? 0;
        for(const {mesh,base,studio,region} of groomedBases){
            mesh.material=count && (values.furQuality!=='face' || region==='face') ? studio : base;
        }
        for (const {shell, layer, density, index, region} of coats) {
            shell.visible = index < count && (values.furQuality !== 'face' || region === 'face');
            layer.value = (index + 1) / (count + 1);
            density.value = 5 / Math.max(1, count);
        }
    }
    const sources = [];
    model.traverse(node => { if (node.isMesh) sources.push(node); });
    for (const mesh of sources) {
        // GLTFLoader gives each primitive its own mesh and material.
        const base = mesh.material;
        const surface = base?.userData?.sysmocapSurface;
        if (!surface || !base.isMeshStandardMaterial) continue;
        const cavity = surface.poseOcclusion;
        if (base.aoMap && expressions && Array.isArray(cavity?.open) && Array.isArray(cavity?.tongue)) {
            mesh.material = occludedMaterial(base,cavity,expressions);
        }
        if (surface.eye) eyes.push({mesh, base, studio: eyeMaterial(base)});
        const spec = surface.fur;
        if (!spec || !mesh.geometry.attributes.color_1 || !mesh.geometry.attributes.uv ||
            !Number.isInteger(spec.maskTexture) || !Number.isFinite(spec.length) || !Number.isFinite(spec.bend)) continue;
        const groom=mesh.geometry.attributes._fur_groom && spec.groom;
        const gainInRange = v => Number.isFinite(v) && v >= 0 && v <= 4;
        const tone = gainInRange(spec.tone?.whiteGain) && Array.isArray(spec.tone.warmGain) &&
            spec.tone.warmGain.length===3 && spec.tone.warmGain.every(gainInRange) ? spec.tone : null;
        const layers = coatLayers(tone,mesh.geometry.attributes._coat_tone);
        if(groom || tone){
            const studio=base.clone();
            studio.onBeforeCompile=shader=>{
                if(groom)applyGroomShader(shader,groom);
                if(tone)applyCoatTone(shader,tone,groom,layers);
            };
            studio.customProgramCacheKey=()=>'avatar-coat-base-3-' + Boolean(groom) + '-' + Boolean(tone) + '-' + (layers?.count ?? 0);
            groomedBases.push({mesh,base,studio,region:spec.region});
        }
        parser.getDependency('texture', spec.maskTexture).then(mask => {
            if (!mask) return;
            for (let index = 0; index < furLevels.high; index++) {
                const {fur, layer, density} = shellMaterial(base, spec, mask, groom, tone, layers);
                const shell = mesh.clone(false);
                shell.name = mesh.name + '_fur_' + index;
                shell.userData = {avatarFurLayer: index};
                shell.material = fur;
                shell.position.set(0, 0, 0);
                shell.quaternion.identity();
                shell.scale.setScalar(1);
                shell.updateMatrix();
                shell.morphTargetInfluences = mesh.morphTargetInfluences;
                shell.renderOrder = index - furLevels.high - 1;
                mesh.add(shell);
                coats.push({shell, layer, density, index, region: spec.region});
            }
            refresh();
        }).catch(error => console.warn('Avatar fur mask could not be loaded', error));
    }
    refresh();
    tuning.onChange(keys => {
        if (keys.some(key => ['lightPreset', 'light', 'furQuality'].includes(key))) refresh();
    });
}
