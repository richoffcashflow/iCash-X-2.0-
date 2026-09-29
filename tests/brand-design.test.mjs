import assert from 'node:assert/strict';
import {brandDesignSchema,brandSvg} from '../lib/brand-design.ts';
const design={title:'Arch',paths:['M 20 80 L 20 40 Q 50 5 80 40 L 80 80']};
assert(brandSvg(design,'#18181b').includes('<path d='));
assert.throws(()=>brandSvg({...design,paths:['M0 0\"/><script>alert(1)</script>']},'#18181b'));
assert.throws(()=>brandSvg(design,'url(https://example.com)'));
assert.throws(()=>brandDesignSchema.parse({designs:[design]}));
assert.equal(brandDesignSchema.parse({designs:[design,design,design]}).designs.length,3);
console.log('Logo schema: three designs, safe paths, safe color passed');
