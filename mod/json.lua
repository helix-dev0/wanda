-- Minimal JSON encoder for the wand_capture mod (M0). NOT a general library:
-- it encodes exactly the value kinds our snapshot / DB dumps contain — strings,
-- numbers, booleans, a NULL sentinel, string-keyed objects, and arrays marked
-- via json.array(). Lua `nil` cannot live inside an array (it makes a hole), so
-- empty spell slots / unlimited-use spells use the M.NULL sentinel instead.
-- Arrays MUST be marked so an empty array encodes as [] (not {}); every other
-- table encodes as a JSON object.
local M = {}

-- Unique sentinel meaning JSON null.
M.NULL = setmetatable({}, { __tostring = function() return "null" end })

-- Mark a table as a JSON array.
function M.array(t)
  return setmetatable(t or {}, { __json_array = true })
end

local function is_array(t)
  local mt = getmetatable(t)
  return mt ~= nil and mt.__json_array == true
end

local function esc(s)
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  -- remaining control bytes (0x00-0x1F) -> \uXXXX so output is always valid JSON
  s = s:gsub("[%z\1-\31]", function(c) return string.format("\\u%04x", c:byte()) end)
  return '"' .. s .. '"'
end

local encode -- forward declaration

local function encode_array(t, out)
  out[#out + 1] = "["
  local n = #t -- safe: NULL sentinel is non-nil, so no holes
  for i = 1, n do
    if i > 1 then out[#out + 1] = "," end
    encode(t[i], out)
  end
  out[#out + 1] = "]"
end

local function encode_object(t, out)
  out[#out + 1] = "{"
  local first = true
  for k, val in pairs(t) do
    if type(k) == "string" then
      if not first then out[#out + 1] = "," end
      first = false
      out[#out + 1] = esc(k)
      out[#out + 1] = ":"
      encode(val, out)
    end
  end
  out[#out + 1] = "}"
end

encode = function(v, out)
  if v == nil or v == M.NULL then
    out[#out + 1] = "null"
    return
  end
  local t = type(v)
  if t == "string" then
    out[#out + 1] = esc(v)
  elseif t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then
      out[#out + 1] = "null" -- NaN / +-Inf are not valid JSON
    else
      out[#out + 1] = tostring(v)
    end
  elseif t == "boolean" then
    out[#out + 1] = v and "true" or "false"
  elseif t == "table" then
    if is_array(v) then encode_array(v, out) else encode_object(v, out) end
  else
    out[#out + 1] = "null" -- functions/userdata are not serialisable
  end
end

function M.encode(value)
  local out = {}
  encode(value, out)
  return table.concat(out)
end

return M
