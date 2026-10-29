// Timing amendment only; the frozen enrollment protocol and all answers stay intact.
export const PILOT_FOLLOWUP_POLICY=Object.freeze({version:'S3-PILOT-FOLLOWUP-24H-20261029-v1',environment:'PILOT',followup_days:1,previous_followup_days:14,requested_on:'2026-10-29',basis:'actual_fourth_course_completion',purpose:'预测试流程与数据收集检查，不代表14天维持效果'});
export function followupPolicy(role,protocol){
 if(role==='PILOT')return {...PILOT_FOLLOWUP_POLICY};
 if(role!=='FORMAL')throw Error('未知后测环境');
 return {version:protocol.version,environment:role,followup_days:protocol.followup_days,basis:'actual_fourth_course_completion'};
}
export function recordFollowupPolicy(state,current,originalProtocol){
 if(!state.visits[5])return current;
 // A post-test that already started keeps its original timing identity.
 return state.visits[5].followup_policy??{version:originalProtocol.version,environment:state.environment,followup_days:originalProtocol.followup_days,basis:'actual_fourth_course_completion'};
}
