// A short local editing buffer protects IME candidates from server normalization and state broadcasts.
function sdTextField(props){
 const {as='input',value,onChange,onBlur,onFocus,onCompositionStart,onCompositionEnd,onKeyDown,...rest}=props;
 const text=as==='textarea'||!rest.type||['text','search','email','url','tel','password'].includes(rest.type);
 const [draft,setDraft]=l.useState(value??''),composing=l.useRef(false),focused=l.useRef(false),last=l.useRef(value??''),timer=l.useRef(null);
 l.useEffect(()=>{if(!focused.current&&!composing.current){setDraft(value??'');last.current=value??'';}},[value]);
 l.useEffect(()=>()=>clearTimeout(timer.current),[]);
 const emit=node=>{clearTimeout(timer.current);const next=node.value;if(next!==last.current){last.current=next;onChange?.({target:node,currentTarget:node});}};
 if(!text||value===undefined)return l.createElement(as,{...props,as:undefined});
 return l.createElement(as,{...rest,value:draft,
 onFocus:event=>{focused.current=true;onFocus?.(event);},
 onChange:event=>{const node=event.currentTarget;setDraft(node.value);clearTimeout(timer.current);if(!composing.current&&!event.nativeEvent?.isComposing){if(rest.type==='search')emit(node);else timer.current=setTimeout(()=>emit(node),250);}},
 onCompositionStart:event=>{clearTimeout(timer.current);composing.current=true;onCompositionStart?.(event);},
 onCompositionEnd:event=>{composing.current=false;setDraft(event.currentTarget.value);emit(event.currentTarget);onCompositionEnd?.(event);},
 onBlur:event=>{focused.current=false;composing.current=false;emit(event.currentTarget);onBlur?.(event);},
 onKeyDown:event=>{if(composing.current||event.nativeEvent?.isComposing||event.keyCode===229)return;onKeyDown?.(event);}
 });
}

// Steam64 exceeds Number.MAX_SAFE_INTEGER. Edit and persist it as text only.
function sdSteamIdField({value='',label,validate,onSave}){
 const [draft,setDraft]=l.useState(value),[error,setError]=l.useState('');
 const focused=l.useRef(false),composing=l.useRef(false),last=l.useRef(value);
 l.useEffect(()=>{if(!focused.current){setDraft(value);setError('');last.current=value;}},[value]);
 const save=()=>{
  if(composing.current)return;
  try{const next=validate(draft);setError('');setDraft(next);if(next!==last.current){onSave(next);last.current=next;}}
  catch(e){setError(e.message||'Steam64 ID 保存失败');}
 };
 return l.createElement('label',{className:'sd-steam-id'},
  l.createElement('span',null,'Steam64 ID'),
  l.createElement('input',{type:'text',inputMode:'numeric',autoComplete:'off',spellCheck:false,value:draft,placeholder:'17 位数字（可选）','aria-label':label,'aria-invalid':!!error,
   onFocus:()=>{focused.current=true;},onChange:e=>{setDraft(e.currentTarget.value);setError('');},
   onCompositionStart:()=>{composing.current=true;},onCompositionEnd:()=>{composing.current=false;},
   onBlur:()=>{focused.current=false;save();},
   onKeyDown:e=>{if(composing.current||e.nativeEvent?.isComposing||e.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();save();}if(e.key==='Escape'){e.preventDefault();setDraft(value);setError('');}}
  }),error&&l.createElement('small',{className:'sd-field-error',role:'alert'},error));
}
