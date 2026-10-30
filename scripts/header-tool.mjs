import {formatHeaderToolStatus,headerToolExitCode,runHeaderTool} from '../src/header-tool.mjs';

runHeaderTool(process.argv.slice(2)).then(report=>{
  const output=formatHeaderToolStatus(report);
  if(output)console.log(output);
  process.exitCode=headerToolExitCode(report);
}).catch(error=>{console.error('Header tool: '+error.message);process.exitCode=1;});
