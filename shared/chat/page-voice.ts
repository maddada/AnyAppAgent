// Voice in an agent's page (a plan's "Change something" note, a question's answer): the page runs
// sandboxed with no bridge to the app, so the app records and transcribes the words itself and then
// runs this script in the page (the phone's web view injectJavaScript, the desktop's
// webContents.executeJavaScript). It goes one way only: the page never calls the app.
//
// The words go into the text box the person was in (the kit's `.gx-box`, or any textarea or text
// input), at its caret; when none was focused, into the last visible box on the page (on a plan:
// the note under the chosen answer, else the notes at the end). They are typed in with the
// browser's own insertText, so the page sees an ordinary edit and saves its draft as usual.

/** The script that puts `text` in the page's text box. Ends in `true` (the web view wants a value). */
export function pageInsertScript(text: string): string {
  return `(function(t){
var box=function(n){return !!n&&n.nodeType===1&&(n.isContentEditable||n.tagName==="TEXTAREA"||(n.tagName==="INPUT"&&/^(text|search|)$/i.test(n.type)))&&!n.readOnly&&!n.disabled&&n.offsetParent!==null;};
var el=document.activeElement;
if(!box(el)){el=null;var all=document.querySelectorAll(".gx-box,textarea:not(.gx-src),input[type=text]");for(var i=all.length-1;i>=0&&!el;i--)if(box(all[i]))el=all[i];
if(!el)return "none";el.focus();
if(el.isContentEditable){var r=document.createRange();r.selectNodeContents(el);r.collapse(false);var s=getSelection();s.removeAllRanges();s.addRange(r);}
else{var n=el.value.length;el.setSelectionRange(n,n);}}
else el.focus();
var before="",after="";
if(el.isContentEditable){var sel=getSelection();if(sel&&sel.rangeCount&&el.contains(sel.getRangeAt(0).startContainer)){var a=sel.getRangeAt(0).cloneRange();a.setStart(el,0);before=a.toString();var b=sel.getRangeAt(0).cloneRange();b.setEnd(el,el.childNodes.length);after=b.toString();}}
else{before=el.value.slice(0,el.selectionStart||0);after=el.value.slice(el.selectionEnd||0);}
before=before.replace(/\\u200b/g,"");after=after.replace(/\\u200b/g,"");
var lead=before&&!/\\s$/.test(before)&&!/^[.,!?;:)]/.test(t)?" ":"";var trail=after&&!/^[\\s.,!?;:)]/.test(after)?" ":"";
var words=lead+t+trail;
if(!document.execCommand("insertText",false,words)){
if(el.isContentEditable){el.textContent=before+words+after;}
else{var p=el.selectionStart||0;el.setRangeText(words,p,el.selectionEnd||p,"end");}
el.dispatchEvent(new Event("input",{bubbles:true}));}
return "ok";
})(${JSON.stringify(text)});true;`;
}
