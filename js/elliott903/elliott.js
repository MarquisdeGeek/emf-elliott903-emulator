/*


* Program loader
* Tape input
* Memory viewer
* Ouput: line printer
* Output: plotter

Also: load from tape... (list of asset files)

Write: KITT example in A/Q register


Paper tape reader 
Teleprinter
paper tape punch
Tape reader 2
Teleprinter 2
Tape punch 2
ElliottDevice = function() {
	return {
		read1: 0;
	}
}
*/

Elliott = function() {
	var SHIFT_ADDRESS = 0;
	var SHIFT_FUNCTION = 13;
	var MASK_B_MODIFIER = 0x20000;
	var MASK_FUNCTION = 0x1e000;
	var MASK_ADDRESS = emf.Number.maskLSB(SHIFT_FUNCTION); // i.e. 8191
	var memory;
	var registers = {};
	var state;
	var device_list = {};
	var enable_protect_instruction_init;
	var rem_instr = ["set B", "add", "neg and add", "store Q", "LOAD", "STORE", "collate", "jump if 0", "jump", "jump if neg", "count in store", "store S", "multiply", "divide", "shift", "block xfer"];

	(function ctor(clone_obj) {

		memory = new Array(8192);
		for(var i=0;i<memory.length;++i) {
			memory[i] = new emf.Number(18, 2, clone_obj?clone_obj.memory[i].get():0);
		}

		state = {};
		state.clock_speed = 128000;

		preloadInitialInstructions();
		coldStart();

		if (clone_obj) {
			registers = $.extend(clone_obj, {} ,true);

			enable_protect_instruction_init = clone_obj.enable_protect_instruction_init;
			device_list = clone_obj.device_list;
			registers.q = clone_obj.registers.q;
			registers.a = clone_obj.registers.a;
			state.clock_speed = clone_obj.state.clock_speed;
		}
	})();

	function clone() {
		return new Elliott(this);
	}

	function preloadInitialInstructions() {
		enable_protect_instruction_init = false;
		loadCode(8180, [
			"/15 8189",
			"0 8180",
			"4 8189",
			"15 2048",
			"9 8186",
			"8 8183",
			"15 2048",
			"/5 8180",
			"10 1",
			"4 1",
			"9 8182",
			"8 8177",
		]
		);
		enable_protect_instruction_init = true;
	}

	function coldStart() {
		registers.a = new emf.Number(18,2,0);
		registers.b = new emf.Number(18,2,0);
		registers.q = new emf.Number(18,2,0);
		registers.scr = new emf.Number(13,2,0);

		priority = 1; // following the Elliott guide, we use 1 to 4, not 0 to 3
		enable_protect_instruction_init = true;
		setSCR(8181);
	}

	// The text might be hex, decimal, or a label/equate
	// Hex: 0xab or $ab
	// Dec: #123
	// Oct: 017
	// Bin: 0101010b
	function refToValue(text, state) {
		if (Number.isInteger(text)) {
			return text;
		}
		//
		if (state && state.labels) {
			if (state.labels[text]) {
				return refToValue(state.labels[text]);
			}
		} else if (state && state.labels) {
			if (state.equates[text]) {
				return refToValue(state.equates[text]);
			}
		}
		// Hex?
		if (text.substr(0,1) == '$') {
			return parseInt(text.substr(1), 16);
		} else if (text.substr(0,2) == '0x') {
			return parseInt(text.substr(2), 16);

		// Dec
		} else if (text.substr(0,1) == '#') {
			return parseInt(text.substr(1), 10);

		// Binary (preced octal, so we can handle prefixed 0's on binary)
		} else if (text.substr(text.length-1, 1) == 'b') {
			return parseInt(text.substr(0, text.length-1), 2);

		// Octal
		} else if (text.substr(0,1) == '0') {
			return parseInt(text.substr(1), 8);
		
		// Plain number, treat it as such (even though we'd prefer people use #123)
		} else if (!isNaN(text)) {
			return parseInt(text, 10);
		}

		return undefined;
	}

	// Return options:
	//  error : instruction existed, but could not be understood
	//  value : if defined, then there's a valid instruction, successfully built
	//          if undefined (but not error) then this instruction updated the state only
	function assemble(addr, text, state) {
		var value;

		// Store, and strip the label (if present) from the line
		var reLabel = /(?:([a-zA-Z][a-zA-Z\d]*)\:)?(?:\s+(.*))?\s*$/;
		found = text.match(reLabel);
		if (found) {
			if (found[1] && found[1] != "") {
				if (state) {
					state.labels = state.labels || [];
					state.labels[found[1]] = addr;
				}
				// If there is only a label on this line, exit now.
				if (found[2] === undefined) {
					return { output: undefined };
				}
				text = found[2];
			}
		}

		// Check for 'id equ 123' lines
		var reEquLine = /([a-zA-Z][a-zA-Z\d]*)\s+equ\s+(\#?\$?\d+)\s*/;
		var found = text.match(reEquLine);
		if (found && state) {
			state.equates = state.equates || [];
			state.equates[found[1]] = found[2];
			return { output: undefined };
		}

		var reCodeLine = /(?:([a-zA-Z][a-zA-Z\d]*)\:)?\s*(\/?)\s*(\d+)\s+([\D\d]+).*/;
		found = text.match(reCodeLine);

		if (found) {
			var v = refToValue(found[4], state);
			if (v === undefined) {
				return { error: "Unknown symbol : " + found[4] }
			}
			value = found[2] ? MASK_B_MODIFIER : 0;
			value += parseInt(found[3],10) << SHIFT_FUNCTION;
			value += v << SHIFT_ADDRESS;
		} else {
			// Look for a literal
			var reLiteralValue = /\s*db\s+(.*)\s*/;
			var found = text.match(reLiteralValue);
			if (found) {
				value = refToValue(found[1], state);
			}
			if (value === undefined) {
				return { error: "Unknown symbol : " + value }
			}
		}

		return { output: value, instruction_length: 1, error: value===undefined?"Could not assembler":null};
	}

	function disassemble(address) {
		if (!isValidAddress(address)) {
			return { output: "?????",  error:"Address is out of range.", instruction_length: 1};
		}

		var instr = getWordAsUnsigned(address);
		var code = '';

		if (instr & MASK_B_MODIFIER) {
			code += '/';
		}

		var intruction_code = (instr & MASK_FUNCTION) >> SHIFT_FUNCTION;
		var intruction_addr = (instr & MASK_ADDRESS) >> SHIFT_ADDRESS;
		code += String(intruction_code);
		code += ' ';
		code += String(intruction_addr);

		var comment = rem_instr[intruction_code] + " 0x" + emf.utils.hex(intruction_addr, 5);

		return { output: code, comment: comment, instruction_length: 1};
	}

	// Q. Fold this into assemble, and vary the output on input?
	function assembleCode(addr, code) {
		var results = [];
		var state = {};
		var wasError;
		var error_list;

		// We run this in two passes, as some errors are due to missing labels.
		// This second pass helps fix that.
		for(var pass = 0;pass < 2;++pass) {
			wasError = false;
			error_list = [];
			var addr_offset = 0;

			for(var i=0;i<code.length;++i) {
				var result = assemble(addr+addr_offset, code[i], state);
				if (result.error) {
					wasError = true;
					++addr_offset;
					error_list.push({ error: result.error, line: i, code: code[i]});
				} else if (result.output !== undefined) {
					results.push(result.output);
					++addr_offset;
				}
			}
			//
			if (!wasError) {
				break;
			}
		}
		return { data: results, error: error_list, state: state };
	}

	function loadCode(address, code) {
		var block = assembleCode(address, code).data;
		for(var i=0;i<block.length;++i) {
			putWord(address + i, block[i]);
		}
	}
	
	function loadBinary(address, code) {
		for(var i=0;i<code.length;++i) {
			putWord(address + i, code[i]);
		}
	}
	
	function attachPlotterDevice(handler) {
		device_list.plotter = handler;
	}
	
	function attachTapeDevice1(handler) {
		device_list.tape1 = handler;
	}

	function attachTapeDevice2(handler) {
		device_list.tape2 = handler;
	}

	function attachTeleprinter1(handler) {
		device_list.teleprinter1 = handler;
	}

	function attachTeleprinter2(handler) {
		device_list.teleprinter2 = handler;
	}

	function setB(new_b) {
		putWord(priority * 2 - 1, new_b);
	}

	function getB() {
		return getWord(priority * 2 - 1);
	}

	function setSCR(new_scr) {
		// For internally emulation (i.e. how the hardware does it)
		putWord(priority * 2 - 2, new_scr);
		// For external API access, treat it like a register
		registers.scr.assign(new_scr);
	}

	function getSCR(new_scr) {
		return getWord(priority * 2 - 2);
	}

	function getWord(addr) {
		addr = validateAddr(addr);
		// We create a new object so that we don't accidentally store the reference
		return new emf.Number(memory[addr]);
	}

	function getWordAsInt(addr) {
		return getWord(addr).get();
	}

	function getWordAsUnsigned(addr) {
		var v = getWord(addr).getUnsigned();
		return v;
	}

	function putWord(addr, data) {
		addr = validateAddr(addr);

		//The instructions are disabled whenever a 15 7168 is obeyed.
		// and enabled on JUMP
		if ((addr > 8180 && addr < 8192) && enable_protect_instruction_init) {
			// nop
		} else {
			memory[addr].assign(data);
		}
	}

	function validateAddr(addr) {
		if (addr instanceof emf.Number) {
			addr = addr.get();
		}
		return addr & (memory.length-1);
	}

	function isValidAddress(addr) {
		if (addr instanceof emf.Number) {
			addr = addr.get();
		}
		return addr >= 0 && addr < memory.length;
	}

	function getState() {
		return {
			q: registers.q,
			a: registers.a,
			priority: priority,
			memory: memory,
			b: getB(),
			scr: registers.scr,
			getRegisterList: function() {
				return [ {reg:'a'} , {reg:'q'} ,  {reg:'b'} , {reg:'scr'} ];
			}
		};
	}

	function step() {
		var address = getSCR();
		var instruction = getWordAsUnsigned(address.get());
		var bmod = (instruction & MASK_B_MODIFIER) ? true : false;
		var funct = (instruction & MASK_FUNCTION) >> SHIFT_FUNCTION;
		var addr = (instruction & MASK_ADDRESS) >> SHIFT_ADDRESS;
		var time_us = [6.5, 30, 23.5, 26.5, 25, 23.5, 25, 23.5, 21, 24, 21, 24, 31.6, 76.5, 79.5, 22, 20.5];
		var useconds = 0;
		var protect = false; // set to true if the instruction defers interrupt

		if (bmod) {
			addr = (addr + getB().get()) & MASK_ADDRESS;
		}
		// Only 16 LSB of addr are used
		addr &= 0xffff;

		address.add(1);
		setSCR(address);

		// Rem: comments are taken from the Elliott manual, which lists the LSB as 1, and MSB as 18
		switch(funct) {
			case 0: // Set B-register
				// B:=Q[18..1]:=m
				registers.q = getWord(addr);
				setB(registers.q);
				protect = true;
				break;

			case 1: // Add
				// A := A + m
				registers.a.add(getWord(addr));
				break;

			case 2: // Negate and add
				// A := m-A
				var m = getWord(addr);
				registers.a.assign(m.sub(registers.a));
				// Q18-1 := m
				registers.q.assign(getWordAsInt(addr));
				break;

			case 3: // Store Q-register
				// m18 := 0
				// m17-1 := Q18-2
				putWord(addr, (registers.q.getUnsigned())>>1);
				break;

			case 4: // LOAD
				// A := m
				registers.a.assign(getWord(addr));
				break;

			case 5: // STORE
				// m := A
				putWord(addr, registers.a);
				break;

			case 6: // Collate
				// A := A and m
				registers.a.bitAnd(getWordAsInt(addr));
				break;

			case 7: // Jump if zero
				if (registers.a.get() == 0) {
					setSCR(addr);
					useconds += 6.5;
				}
				break;

			case 8: // Jump
				// S := M
				setSCR(addr);
				break;

			case 9: // Jump if negative
				if (registers.a.get() < 0) {
					setSCR(addr);
					useconds += 6.5;
				}
				break;

			case 10: // Count in store
				var r = getWordAsInt(addr);
				r += 1;
				putWord(addr, r);
				break;

			case 11: // Store SCR-register
				var sreg = getSCR();
				sreg.add(1);
				// m13-1 := (S+1)13-1
				// Q18-14 := (S+1)16-14
				// Q13-1 := 0
				putWord(addr, (address+1) & emf.Number.maskLSB(13));
				registers.q.assign((address+1) & ~emf.Number.maskLSB(13));
				break;

			case 12: // Multiply
				// (A,Q[18..2]):=A*m; 
				// Q1:=1 if A<0 otherwise 0
				var aq = new emf.Number(36);
				aq.assign(registers.a);
				aq.mul((registers.q.getUnsigned())>>1);

				registers.a.assign(aq.getMasked(35,17));
				registers.q.assign(aq.getMasked(17,0));

				if (registers.a.isNegative()) {
					registers.q.bitOr(1);
				} else {
					registers.q.bitAnd(~1);
				}
				break;

			case 13: // Divide
				// A:=(A,Q[18..2])/m  +/- 2^-17; 
				// Q[18..2]:=A +/- 2^-17; 
				// A[1]:=1; Q[1]:=0
				var aq = new emf.Number(36);
				aq.assign(registers.a);
				aq.shiftLogicalLeft(18);
				aq.bitOr(registers.q.getUnsigned() >> 1);

				aq.divide(getWordAsUnsigned(addr));

				registers.a.assign(aq.getMasked(17,0));
				registers.q.assign(aq.getMasked(17,1));

				registers.a.bitOr(1);
				registers.q.bitAnd(~1);
				break;

			case 14: // left shift/right shift
                // (A,q) := ((A, Q) + Q[1]) * 2^Z left shift, 2^8192-Z right shift
 				var aq = new emf.Number(36);
				aq.assign(registers.a);
				aq.shiftLogicalLeft(18);
				aq.bitOr(registers.q.getUnsigned());
                if (addr <= 2047) {
                	q.shiftLogicalLeft(addr);
                } else if (addr >= 6144) {
                	q.shiftLogicalRight(8192 - addr);
                }
                // Other elliott machines handle IO here, too.
                else if (addr == 4864) {
                	// TODO: plotter operations
                }
				break;

			case 15: // i/o
				if (addr >= 4864 && addr < 4866) { // plotter operations
					// TODO : NOP
				} else if (addr >= 2048 && addr <= 6148) { // Block transfer
					useconds += doBlockOperation(addr);
				} else if (addr == 7168) {
					priority--;
					enable_protect_instruction_init = false;
				}
				// 
				break;

		}

		// use state.clock_speed, and 
		useconds += time_us[funct] * 1000000;
		return { useconds: useconds };
	}

	function update(t/* in useconds*/) {
		var duration = 0;
		do {
			duration += step().useconds;
		} while(duration < t);
	}

	function doBlockOperation(op) {
		switch(op) {
		case 2048:
			// TODO: handle EOF cases
			if (device_list.tape1) {
				registers.a.shiftLogicalLeft(7);
				registers.a.bitOr(device_list.tape1.fetch().data);
			}
			break;

		case 2050:
			// TODO: handle EOF cases
			if (device_list.tape2) {
				registers.a.shiftLogicalLeft(7);
				registers.a.bitOr(device_list.tape2.fetch().data);
			}
			break;
		
		case 6148:
			writeCode(device_list.teleprinter1, registers.a.getUnsigned());
			break;
		
		case 4864:
			device_list.plotter.writeCharacter(registers.a.getUnsigned());
			break;
		
		}
		// TODO: Correctly handle timings
		return 0;
	}

    // 903 TELECODE
    //         00   10   20   30    40    50    60    70   100    110   120   130   140   150   160 
    // 
    // 0      blank            sp    (     0     8   ` ’     H     P     X     @     h     p     x                                                 
    // 1            tab        !     )     1     9     A     I     Q     Y     a     i     q     y
    // 2            lf         "     *     2     :     B     J     R     Z     b     j     r     z   
    // 3                     # ½     +     3     ;     C     K     S     [     c     k     s                           
    // 4           halt        $     ,     4     <     D     L     T     £     d     l     t      
    // 5            cr         %     -     5     =     E     M     U     ]     e     m     u     
    // 6                       &     .     6     >     F     N     V   ^ ↑     f     n     v    
    // 7       bell          ' ‘     /     7  ?  º     G     O     W   _ ←     g     o     w    erase   
	function writeCode(teleprinter, c) {
		if (!teleprinter) {
			return;
		}
		var teleCode903   = "........" + ".\t\n..\r.." + "........"  + " !\".$%&." +
                            "()*+,-./" + "01234567" + "89:;<=>." + ".ABCDEFG" + "HIJKLMNO"  +
                            "PQRSTUVW" + "XYZ[.]^<" + "@abcdefg" + "hijklmno" + "pqrstuvw"  +
                            "xyz.....";
		teleprinter.onCharacterPrint(teleCode903.substr(c, 1));
	}

	return {
		clone,
		coldStart,
		getState,
		step,
		update,
		assemble,
		disassemble,
		assembleCode,
		getWord : getWordAsInt,
		getWordAsUnsigned,
		isValidAddress,
		//
		attachPlotterDevice,
		attachTapeDevice1,
		attachTapeDevice2,
		attachTeleprinter1,
		attachTeleprinter2
	}
}
