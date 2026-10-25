import {flushSync} from 'react-dom';
import {publishConnectionIndicators} from './ConnectionIndicators';
import {publishConnectionSettings} from './ConnectionSettings';
/** Both projections describe one status; commit them before controller DOM reads. */
export function publishConnectionSummary(
 indicators:Parameters<typeof publishConnectionIndicators>[0],
 settings:Parameters<typeof publishConnectionSettings>[0],
){
 const updates:(()=>void)[]=[];
 const collect=(update:()=>void)=>{updates.push(update);};
 publishConnectionIndicators(indicators,collect);
 publishConnectionSettings(settings,collect);
 if(updates.length)flushSync(()=>{for(const update of updates)update();});
}
