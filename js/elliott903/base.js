var gVars = {};
gVars.runClockSpeed = 35;

$(window).load(function() {

	new sgx.main.System();

	sgx.graphics.Engine.create(640, 400);	// the size of the draw area we (as programmers) will use

	sgx.main.System.writePage();
	sgx.main.System.initialize();	// optionally pass the 'loading_screen' ID here, to hide the contents once loaded
	
	gVars.led = sgx.graphics.TextureManager.get().registerScenarioTexture("img/led");
	gVars.texture = sgx.graphics.TextureManager.get().registerScenarioTexture("img/panel", function(t) {
		//t.loaded = true;
	});
	gVars.mainSurface = sgx.graphics.DrawSurfaceManager.get().getDisplaySurface();

	// TODO: Don't use SGX control loop - sgx.main.[system?].disableUpdate();
});

function SGXPrepare_OS(){}
function SGXinit() {}
function SGXstart() {
	initialiseElliott();
}
function SGXdraw() {
}
function SGXupdate(telaps) {}




function initialiseElliott() {

	resetElliott();

	$('#emf_reset').click(function(ev) {
		resetElliott();
	});

	$('#emf_run').click(function(ev) {
		startElliott();
	});

	$('#emf_step').click(function(ev) {
		stepElliott();
	});

	$('#emf_stop').click(function(ev) {
		stopElliott();
	});

	$('#dbus_input_inp').keypress(function(e) {
		var keycode = (e.keyCode ? e.keyCode : e.which);
		if (keycode == '13') {
			var cmd = e.currentTarget.value;
			var cmd_output = gVars.debugemf.executeCommand(cmd);
			if (cmd_output != "") {
				$("#dbug_output").append(cmd_output);
				$("#dbug_output").append("<br>");
			}
			e.currentTarget.value = '';
		}
	});

}

function resetElliott() {
	gVars.emulatedMachine = new Elliott();
	gVars.debugemf = new emf.debugemf();

	// Due to the size, this gets loaded at 8165
	var tape_contents = gVars.emulatedMachine.assembleCode([
		"0 8172",	// the ptr/index in B
		"/4 8173",  // load the next character (ptr + 8173)
		"7 8171",   // if nul, exit
		"10 1",  // inc the ptr
		"15 6148",  // write a to teleprinter
		"8 8166",   // jmp to start of loop
		"8 8171", // spin here : could also use 15 7168 (return to lower iriority level)
		//8172
		"#0", // ptr
		// Data
		"#71", "#99", "#25", "#0"
		]);
	var tape_binary = makeTape(gVars.emulatedMachine, tape_contents);

	gVars.tape1 = new emf.device.PaperTape(tape_binary);
	gVars.emulatedMachine.attachTapeDevice1(gVars.tape1);
	gVars.emulatedMachine.attachTeleprinter1(new emf.device.Teleprinter("#lineprinter"));

	updateUI();
	drawElliottUI();
}

//
// Drawing methods
//
function drawElliottUI() {
	drawMachine(gVars.mainSurface);
	drawState(gVars.mainSurface, gVars.emulatedMachine.getState());
}

function drawMachine(surface) {
	surface.setFillColor(sgxColorRGBA.white);
	surface.setFillTexture(gVars.texture);
	surface.fillRect();
}

function drawState(surface, state) {
	//
	surface.setFillTexture(gVars.led);
	drawRegisterState(surface, 145, 65, state.a)
	drawRegisterState(surface, 145, 95, state.q)
	// TODO: is SCR really 'program counter' (given PC is 12 bits, and SCR is 13)?
	drawRegisterState(surface, 251, 285+17, state.scr)

}

function drawRegisterState(surface, x, y, reg) {
	var value = reg.getUnsigned();
	for(var i=reg.getBitWidth()-1;i>=0;--i) {
		if (value & (1<<i)) {
			surface.fillPoint(x, y, sgx.graphics.DrawSurface.eFromCenter);
		}
		x += 23;
	}
}


//
// Updating methods
//
function updateUI(previous) {
	var pc =  gVars.emulatedMachine.getState()['scr'].getUnsigned();
	var startat = pc > 2 ? pc-2 : 0;
	emf.framework.disassemble("#disassembly", gVars.emulatedMachine, startat, startat+16, pc);
	emf.framework.memory("#memory", gVars.emulatedMachine, 8180, 8192, previous);
	emf.framework.registers("#registers", gVars.emulatedMachine, previous);
	emf.framework.paperTape("#tape1", gVars.tape1);
}

var runningTimer = -1;
function startElliott() {
	var previous = gVars.emulatedMachine.clone();
	var hit_break = false;
	for(var i=0;i<gVars.runClockSpeed && !hit_break;++i) {
		gVars.emulatedMachine.step();

		var pc = gVars.emulatedMachine.getState()['scr'].getUnsigned();
		hit_break = gVars.debugemf.isBreakpoint(pc);
	}
	updateUI(previous);
	drawElliottUI();

	if (hit_break) {
		stopElliott();
	} else {
		runningTimer = setTimeout(startElliott, 10);		
	}
}

function stepElliott() {
	// Store the previous version of the machine
	var previous = gVars.emulatedMachine.clone();

	// Do a step
	gVars.emulatedMachine.step();

	// Refresh the UI
	updateUI(previous);
	drawElliottUI();
}

function stopElliott() {
	if (runningTimer != -1) {
		clearTimeout(runningTimer);
		runningTimer = -1;
	}
}