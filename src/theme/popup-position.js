/** Fixed-coordinate placement shared by menus and tooltips. Visual viewport
 * offsets keep popups reachable during pinch zoom and mobile keyboard changes. */
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
export function popupViewport(view) {
  const viewport=view?.visualViewport;
  return {left:Math.max(0,finite(viewport?.offsetLeft)),top:Math.max(0,finite(viewport?.offsetTop)),
    width:Math.max(0,finite(viewport?.width,finite(view?.innerWidth))),
    height:Math.max(0,finite(viewport?.height,finite(view?.innerHeight)))};
}
export function placePopup({x=0,y=0,width=0,height=0,viewport={},alternateX,alternateY,margin=2}={}) {
  const left=finite(viewport.left),top=finite(viewport.top),vw=Math.max(0,finite(viewport.width)),vh=Math.max(0,finite(viewport.height));
  const gap=Math.max(0,finite(margin,2)),gx=Math.min(gap,vw/2),gy=Math.min(gap,vh/2);
  const minX=left+gx,minY=top+gy,maxWidth=Math.max(0,vw-2*gx),maxHeight=Math.max(0,vh-2*gy);
  width=Math.max(0,finite(width));height=Math.max(0,finite(height));x=finite(x,minX);y=finite(y,minY);
  const maxX=left+vw-gx-width,maxY=top+vh-gy-height;
  if((x<minX||x>maxX)&&Number.isFinite(alternateX)&&alternateX>=minX&&alternateX<=maxX)x=alternateX;
  if((y<minY||y>maxY)&&Number.isFinite(alternateY)&&alternateY>=minY&&alternateY<=maxY)y=alternateY;
  return {left:Math.max(minX,Math.min(x,maxX)),top:Math.max(minY,Math.min(y,maxY)),maxWidth,maxHeight};
}
