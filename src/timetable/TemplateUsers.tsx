export function TemplateUsers({names=[]}:{names?:string[]}){
  const text='使用该模板的同学：'+(names.length?names.join('、'):'暂无');
  return <p className="template-users" title={text}>{text}</p>;
}
