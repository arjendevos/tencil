// bippy's entry imports React for optional hook helpers we never call. The
// overlay must not bundle (or collide with) the page's React, so it resolves here.
export const useEffect = undefined;
export const useReducer = undefined;
export const useRef = undefined;
