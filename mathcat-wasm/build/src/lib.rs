//! JS-facing wrapper over libmathcat::interface (MathCAT 0.7.2).
//! Speech: PLAN-MATHCAT-SPEECH-PROOFING.md (M9).
//! Navigation + braille: PLAN-MATHCAT-NAVIGATION.md (N9 revises M9); the
//! braille functions are built now but unused until the comparison view.
use libmathcat::interface as mc;
use wasm_bindgen::prelude::*;

fn js_err(e: libmathcat::errors::Error) -> JsValue {
    JsValue::from_str(&mc::errors_to_string(&e))
}

/// Must be called once before anything else (MathCAT: SetRulesDir first).
/// With `include-zip`, the rules are embedded and "Rules" names the virtual dir.
#[wasm_bindgen(js_name = init)]
pub fn init() -> Result<(), JsValue> {
    mc::set_rules_dir("Rules".to_string()).map_err(js_err)
}

#[wasm_bindgen(js_name = version)]
pub fn version() -> String {
    mc::get_version()
}

#[wasm_bindgen(js_name = setMathML)]
pub fn set_mathml(mathml: &str) -> Result<String, JsValue> {
    mc::set_mathml(mathml.to_string()).map_err(js_err)
}

#[wasm_bindgen(js_name = getSpokenText)]
pub fn get_spoken_text() -> Result<String, JsValue> {
    mc::get_spoken_text().map_err(js_err)
}

#[wasm_bindgen(js_name = setPreference)]
pub fn set_preference(name: &str, value: &str) -> Result<(), JsValue> {
    mc::set_preference(name.to_string(), value.to_string()).map_err(js_err)
}

#[wasm_bindgen(js_name = getPreference)]
pub fn get_preference(name: &str) -> Result<String, JsValue> {
    mc::get_preference(name.to_string()).map_err(js_err)
}

// ---- navigation (PLAN-MATHCAT-NAVIGATION.md 3.2) --------------------------

/// Named navigation command, as NVDA sends it (navCommands.py). Returns SSML.
#[wasm_bindgen(js_name = doNavigateCommand)]
pub fn do_navigate_command(command: &str) -> Result<String, JsValue> {
    mc::do_navigate_command(command.to_string()).map_err(js_err)
}

/// [id, offset] of the current navigation node.
#[wasm_bindgen(js_name = getNavigationMathMLId)]
pub fn get_navigation_mathml_id() -> Result<Vec<JsValue>, JsValue> {
    let (id, offset) = mc::get_navigation_mathml_id().map_err(js_err)?;
    Ok(vec![JsValue::from_str(&id), JsValue::from(offset as u32)])
}

/// [mathml, offset] of the current navigation node (its canonical subtree).
#[wasm_bindgen(js_name = getNavigationMathML)]
pub fn get_navigation_mathml() -> Result<Vec<JsValue>, JsValue> {
    let (mathml, offset) = mc::get_navigation_mathml().map_err(js_err)?;
    Ok(vec![JsValue::from_str(&mathml), JsValue::from(offset as u32)])
}

/// Move navigation to the node with this id (reserved for a MathJax-driven view).
#[wasm_bindgen(js_name = setNavigationNode)]
pub fn set_navigation_node(id: &str, offset: u32) -> Result<(), JsValue> {
    mc::set_navigation_node(id.to_string(), offset as usize).map_err(js_err)
}

// ---- braille (built now, unused until the comparison view) ---------------

/// Braille for the whole expression; nav_id = "" or the id of a node to mark.
#[wasm_bindgen(js_name = getBraille)]
pub fn get_braille(nav_id: &str) -> Result<String, JsValue> {
    mc::get_braille(nav_id.to_string()).map_err(js_err)
}

/// Braille for the current navigation node.
#[wasm_bindgen(js_name = getNavigationBraille)]
pub fn get_navigation_braille() -> Result<String, JsValue> {
    mc::get_navigation_braille().map_err(js_err)
}
