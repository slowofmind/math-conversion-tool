function Pandoc(doc)
  -- A recursive function to walk through the document blocks top-down
  local function process_blocks(blocks, current_depth)
    for i, block in ipairs(blocks) do
      
      -- If the block is an Ordered List
      if block.t == 'OrderedList' then
        local attrs = block.listAttributes
        
        -- 'DefaultStyle' means the author used a standard \begin{enumerate}
        -- If it is anything else, they manually set a marker, so we leave it alone.
        if attrs.style == 'DefaultStyle' then
          if current_depth == 1 then
            attrs.style = 'Decimal'      -- 1, 2, 3
          elseif current_depth == 2 then
            attrs.style = 'LowerAlpha'   -- a, b, c
          elseif current_depth == 3 then
            attrs.style = 'LowerRoman'   -- i, ii, iii
          elseif current_depth == 4 then
            attrs.style = 'UpperAlpha'   -- A, B, C
          else
            attrs.style = 'Decimal'      -- Fallback for extremely deep lists
          end
        end
        
        -- Apply the updated attributes back to the list
        block.listAttributes = attrs
        
        -- Recursively process the items inside this list, increasing the depth counter
        for j, item_blocks in ipairs(block.content) do
          block.content[j] = process_blocks(item_blocks, current_depth + 1)
        end
        
      -- Traverse into container blocks (like Divs or Quotes) without increasing list depth
      elseif block.t == 'Div' or block.t == 'BlockQuote' then
        block.content = process_blocks(block.content, current_depth)
      end
      
    end
    return blocks
  end

  -- Start processing the entire document at list depth 1
  doc.blocks = process_blocks(doc.blocks, 1)
  return doc
end