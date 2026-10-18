export const TRAINING_VERSION='S3-SOURCE-ADAPTED-4-TEST-v1';
export function sourceAdaptedContent(base,groups){
 const c=structuredClone(base);
 c.version='S3-MD-4SESSION-DEMO-v0.9';c.groups=structuredClone(groups);
 c.material_versions={...c.material_versions,training:TRAINING_VERSION};
 c.training_ui={version:'S3-SOURCE-ADAPTED-PRESENTATION-v1',first_response:'先按自己的想法写，把理由说清楚就可以。提交后会看到讲解。你可以不同意示例，也可以保留原来的回答。这里不会给你评定品德或能力。'};
 c.training_status={version:TRAINING_VERSION,source_manuscript:'S3-SOURCE-ADAPTED-4-DRAFT-v1',local_test_only:true,empirically_matched:false,effectiveness_validated:false,assessment_status:'unscored_practice_not_validated_outcome',structure:'initial_2_change_1_application_2_optional_revision_1_card_1',reflection_collected:false};
 c.course_experience=[
  {id:'clarity',text:'今天的说明是否容易理解？',labels:['非常难理解','比较难理解','一般','比较容易理解','非常容易理解']},
  {id:'difficulty',text:'今天的任务难度如何？',labels:['非常简单','比较简单','适中','比较困难','非常困难']},
  {id:'fatigue',text:'今天做下来有多疲劳？',labels:['完全不疲劳','有一点疲劳','中等疲劳','比较疲劳','非常疲劳']},
  {id:'interest',text:'今天的课程对你有多大吸引力？',labels:['完全没有吸引力','吸引力较小','一般','比较有吸引力','非常有吸引力']},
  {id:'usefulness',text:'你觉得今天学的方法对日常学习或生活有多大用处？',labels:['完全没用','用处较小','一般','比较有用','非常有用']}
 ];
 return c;
}
