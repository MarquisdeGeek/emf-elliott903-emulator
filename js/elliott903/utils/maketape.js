
function makeTape(e, code) {
	var tape = [];
	var code_size = code.length;

	// Write standard bootstrap
	writeInstruction(tape, e.assemble(0, "0 8179").output);
	writeInstruction(tape, e.assemble(0, "8 8182").output);
	writeInstruction(tape, -(code_size+3));

	// Write code
	for(var i=0;i<code_size;++i) {
		writeInstruction(tape, code[i]);
	}

	// append JMP to start
	writeInstruction(tape, e.assemble(0, "8 " + (8177-code_size)).output);
	writeInstruction(tape, 0);
	writeInstruction(tape, 0);

	return tape;
}

function writeInstruction(tape, instr) {
	// 76 : 3-0 : 6-0 : 6-0
	tape.push(76); //aka 0x4c
	tape.push((instr >> 14) & 0x0f);
	tape.push((instr >> 7) & 0x7f);
	tape.push((instr >> 0) & 0x7f);
}
