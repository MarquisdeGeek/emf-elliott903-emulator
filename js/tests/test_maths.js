

function testTrue(r) {
	if (!r) {
		console.log("ERROR...");
	}
}

var em = emf.Number(8, 2, 12);

var r = em.assign(200);
var r2 = r.add(1);

console.log(em.get());


testTrue(em.assign(256).equals(0));

testTrue(em.assign(128).equals(-128));
testTrue(em.assign(127).add(1).equals(-128));
testTrue(em.assign(1).neg().equals(-1));

testTrue(em.assign(-39).add(92).equals(53));


