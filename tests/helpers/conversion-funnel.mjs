import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as funnel from '../../lib/conversion-funnel.ts';
const require=createRequire(import.meta.url),mod={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../../components/conversion-funnel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','module','exports',code)(name=>name==='@/lib/conversion-funnel'?funnel:name==='react/jsx-runtime'?require(name):{default:{}},mod,mod.exports);
export const ConversionFunnel=mod.exports.ConversionFunnel;
