import {defs, tiny} from './examples/common.js';
import {Shape_From_File} from "./examples/obj-file-demo.js";
import {Color_Phong_Shader, Shadow_Textured_Phong_Shader,
    Depth_Texture_Shader_2D, Buffered_Texture, LIGHT_DEPTH_TEX_SIZE} from './examples/shadow-demo-shaders.js'

const {
    Vector, Vector3, vec, vec3, vec4, color, hex_color, Shader, Matrix, Mat4, Light, Shape, Material, Scene, Texture
} = tiny;

const {Cube, Axis_Arrows, Textured_Phong} = defs

export class Body {
    // **Body** can store and update the properties of a 3D body that incrementally
    // moves from its previous place due to velocities.  It conforms to the
    // approach outlined in the "Fix Your Timestep!" blog post by Glenn Fiedler.
    constructor(shape, material, size, user_projectile) {
        Object.assign(this,
            {shape, material, size, user_projectile})
        this.hit = false;
    }

    // (within some margin of distance).
    static intersect_cube(p, margin = 0) {
        return p.every(value => value >= -1 - margin && value <= 1 + margin)
    }

    static intersect_sphere(p, margin = 0) {
        return p.dot(p) < 1 + margin;
    }

    emplace(location_matrix, linear_velocity, angular_velocity, spin_axis = vec3(0, 0, 0).randomized(1).normalized()) {                               // emplace(): assign the body's initial values, or overwrite them.
        this.center = location_matrix.times(vec4(0, 0, 0, 1)).to3();
        this.rotation = Mat4.translation(...this.center.times(-1)).times(location_matrix);
        this.previous = {center: this.center.copy(), rotation: this.rotation.copy()};
        // drawn_location gets replaced with an interpolated quantity:
        this.drawn_location = location_matrix;
        this.temp_matrix = Mat4.identity();
        return Object.assign(this, {linear_velocity, angular_velocity, spin_axis})
    }

    advance(time_amount) {
        // advance(): Perform an integration (the simplistic Forward Euler method) to
        // advance all the linear and angular velocities one time-step forward.
        this.previous = {center: this.center.copy(), rotation: this.rotation.copy()};
        // Apply the velocities scaled proportionally to real time (time_amount):
        // Linear velocity first, then angular:
        this.center = this.center.plus(this.linear_velocity.times(time_amount));
        this.rotation.pre_multiply(Mat4.rotation(time_amount * this.angular_velocity, ...this.spin_axis));
    }

    // The following are our various functions for testing a single point,
    // p, against some analytically-known geometric volume formula

    blend_rotation(alpha) {
        // blend_rotation(): Just naively do a linear blend of the rotations, which looks
        // ok sometimes but otherwise produces shear matrices, a wrong result.

        // TODO:  Replace this function with proper quaternion blending, and perhaps
        // store this.rotation in quaternion form instead for compactness.
        return this.rotation.map((x, i) => vec4(...this.previous.rotation[i]).mix(x, alpha));
    }

    blend_state(alpha) {
        // blend_state(): Compute the final matrix we'll draw using the previous two physical
        // locations the object occupied.  We'll interpolate between these two states as
        // described at the end of the "Fix Your Timestep!" blog post.
        this.drawn_location = Mat4.translation(...this.previous.center.mix(this.center, alpha))
            .times(this.blend_rotation(alpha))
            .times(Mat4.scale(...this.size));
    }

    check_if_colliding(b, collider) {
        // check_if_colliding(): Collision detection function.
        // DISCLAIMER:  The collision method shown below is not used by anyone; it's just very quick
        // to code.  Making every collision body an ellipsoid is kind of a hack, and looping
        // through a list of discrete sphere points to see if the ellipsoids intersect is *really* a
        // hack (there are perfectly good analytic expressions that can test if two ellipsoids
        // intersect without discretizing them into points).
        if (this == b)
            return false;
        // Nothing collides with itself.
        // Convert sphere b to the frame where a is a unit sphere:
        const T = this.inverse.times(b.drawn_location.times(Mat4.scale(1,1.5,1)), this.temp_matrix);

        const {intersect_test, points, leeway} = collider;
        // For each vertex in that b, shift to the coordinate frame of
        // a_inv*b.  Check if in that coordinate frame it penetrates
        // the unit sphere at the origin.  Leave some leeway.
        return points.arrays.position.some(p =>
            intersect_test(T.times(p.to4(1)).to3(), leeway));
    }
}


export class Simulation extends Scene {
    // **Simulation** manages the stepping of simulation time.  Subclass it when making
    // a Scene that is a physics demo.  This technique is careful to totally decouple
    // the simulation from the frame rate (see below).
    constructor() {
        super();
        Object.assign(this, {time_accumulator: 0, time_scale: 1, t: 0, dt: 1 / 20, bodies: [], steps_taken: 0});
        this.light = 0;
    }

    simulate(frame_time) {
        // simulate(): Carefully advance time according to Glenn Fiedler's
        // "Fix Your Timestep" blog post.
        // This line gives ourselves a way to trick the simulator into thinking
        // that the display framerate is running fast or slow:
        frame_time = this.time_scale * frame_time;

        // Avoid the spiral of death; limit the amount of time we will spend
        // computing during this timestep if display lags:
        this.time_accumulator += Math.min(frame_time, 0.1);
        // Repeatedly step the simulation until we're caught up with this frame:
        while (Math.abs(this.time_accumulator) >= this.dt) {
            // Single step of the simulation for all bodies:
            this.update_state(this.dt);
            for (let b of this.bodies)
                b.advance(this.dt);
            // Following the advice of the article, de-couple
            // our simulation time from our frame rate:
            this.t += Math.sign(frame_time) * this.dt;
            this.time_accumulator -= Math.sign(frame_time) * this.dt;
            this.steps_taken++;
        }
        // Store an interpolation factor for how close our frame fell in between
        // the two latest simulation time steps, so we can correctly blend the
        // two latest states and display the result.
        let alpha = this.time_accumulator / this.dt;
        for (let b of this.bodies) b.blend_state(alpha);
    }

    make_control_panel() {
        // make_control_panel(): Create the buttons for interacting with simulation time.
        this.key_triggered_button("Speed up time", ["y"], () => this.time_scale *= 5.0);
        this.key_triggered_button("Slow down time", ["u"], () => this.time_scale /= 5.0);
        this.new_line();
        this.live_string(box => {
            box.textContent = "Time scale: " + this.time_scale
        });
        this.new_line();
        this.live_string(box => {
            box.textContent = "Fixed simulation time step size: " + this.dt
        });
        this.new_line();
        this.live_string(box => {
            box.textContent = this.steps_taken + " timesteps were taken so far."
        });
        this.new_line();

        this.key_triggered_button("Change Light Color", ["h"], () =>{
            this.r = Math.random();
            this.g = Math.random();
            this.b = Math.random();
        });
        this.new_line();
        this.key_triggered_button("Original Light Color", ['j'], () => {
            this.r = 0.917;
            this.g = 0.792;
            this.b = 0.949;
        })

        this.new_line();
        this.key_triggered_button("Change Light Position", ["n"], () =>{
            this.x = ((Math.random() * 100) % 60) - 20;
            this.y = ((Math.random() * 100) % 40) - 10;
            this.z = ((Math.random() * 100) % 3) + 2;
        });
        this.new_line();
        this.key_triggered_button("Original Light Position", ['m'], () => {
            this.x = 36;
            this.y = 21;
            this.z = 0;
        })

    }

    display(context, program_state) {
        // display(): advance the time and state of our whole simulation.
        if (program_state.animate)
            this.simulate(program_state.animation_delta_time);
        // Draw each shape at its current location:
        for (let b of this.bodies)
            b.shape.draw(context, program_state, b.drawn_location, b.material);
    }

    update_state(dt)      // update_state(): Your subclass of Simulation has to override this abstract function.
    {
        throw "Override this"
    }
}

export class Group extends Simulation {
    constructor() {
        super();

        this.meteorites = {
            rock: new defs.Subdivision_Sphere(1),
            sphere2: new (defs.Subdivision_Sphere.prototype.make_flat_shaded_version())(2),
            sphere3: new defs.Subdivision_Sphere(3),
            cube: new defs.Cube(),
        };

        this.shapes = {
            head: new defs.Subdivision_Sphere(5),
            rock: new defs.Subdivision_Sphere(1),
            cube: new defs.Cube(),
            sphere: new defs.Subdivision_Sphere(4),
            sphere2: new (defs.Subdivision_Sphere.prototype.make_flat_shaded_version())(2),
            sphere3: new defs.Subdivision_Sphere(3),
            moon: new (defs.Subdivision_Sphere.prototype.make_flat_shaded_version())(1),
            circle: new defs.Regular_2D_Polygon(1, 15),
            opm: new Shape_From_File("assets/saitama-ok-memechallenge/source/Saitama_OK_Cel_shaded/Saitama_OK_Cel_shaded.obj"),
            platform: new defs.Cube(),
            pillar: new defs.Cylindrical_Tube(10,10,[[0,1],[0,1]]),

        };

        this.materials = {
            rock: new Material(new defs.Phong_Shader(),
                {ambient: .4, specularity: 0.9, color: hex_color("#6c6c6c")}),
            skin: new Material(new defs.Phong_Shader(),
                {ambient: .15, specularity: 0.9, color: hex_color("#e0ac69")}),
            ring: new Material(new Ring_Shader(),
                {ambient: 1, diffusivity: 0, specularity: 0, color: hex_color("#b08040")}),
            body_suit: new Material(new defs.Phong_Shader(),
                {ambient: .15, specularity: 0.9, color: hex_color("#ffff00")}),
            eye: new Material(new defs.Phong_Shader(),
                {ambient: .15, specularity: 0.9, color: hex_color("#ffffff")}),
            opm: new Material(new Textured_Phong(),
                {   color: hex_color("#000000"),
                    ambient: 0.7, diffusivity: 0.1, specularity: 0.7,
                    texture: new Texture("assets/saitama-ok-memechallenge/textures/Saitama_OK_diffuse.png", "NEAREST")}),
            sun: new Material(new defs.Phong_Shader(),
                {ambient:1, color: hex_color("#ffffff")}),
            background_objects: new Material(new defs.Phong_Shader(),
                {ambient:0.2, diffusivity: 0.5, specularity:0.5, color: hex_color("#ffffff")}),
            temp: new Material( new Textured_Phong(),
                {color: hex_color("#000000"),
                ambient: 0.5, diffusivity: 0.1}),
            }

        this.colliders = [
            {intersect_test: Body.intersect_sphere, points: new defs.Subdivision_Sphere(1), leeway: 1},
            {intersect_test: Body.intersect_sphere, points: new defs.Subdivision_Sphere(4), leeway: 2},
            {intersect_test: Body.intersect_cube, points: new defs.Cube(), leeway: .1}
        ];
        this.collider_selection = 1;
        let opm_scale = Mat4.scale(15,15,15);
        let opm_rot = Mat4.rotation(0.5, 0,1,0);
        this.opm = new Body(this.shapes.opm, this.materials.opm, vec3(5,5,5), false)
            .emplace(opm_scale.times(opm_rot).times(Mat4.identity()),
                0, 0);

        let pillar_scale = Mat4.scale(10, 100, 10);
        let pillar_translation = Mat4.translation(-2, 0, -1);
        let pillar_rotation = Mat4.rotation(55, 1, 0, 0);
        this.pillars = new Body(this.shapes.pillar, this.materials.background_objects, vec3(10,10,10), false)
            .emplace(pillar_scale.times(pillar_translation).times(pillar_rotation).times(Mat4.identity()),
                0,0);

        //let model_transform_cylinder = model_transform.times(Mat4.translation(-21,10,-20)).times(Mat4.scale(10, 100, 10)).times(Mat4.rotation(55, 1,0,0));

        this.initial_camera_location = Mat4.look_at(vec3(0, 0, 20), vec3(0, 0, 0), vec3(0, 1, 0));
        this.animation_queue = [];

        //Color of the light source
        this.r = 0.917;
        this.g = 0.792;
        this.b = 0.949;

        //XYZ coordinates of the light source
        this.x = 36;
        this.y = 21;
        this.z = 0;
        this.counter = 0;
    }

    random_shape(shape_list = this.meteorites) {
        // random_shape():  Extract a random shape from this.shapes.
        const shape_names = Object.keys(shape_list);
        return shape_list[shape_names[~~(shape_names.length * Math.random())]]
    }

    increase() {
        this.collider_selection = Math.min(this.collider_selection + 1, this.colliders.length - 1);
    }

    decrease() {
        this.collider_selection = Math.max(this.collider_selection - 1, 0)
    }

    update_state(dt) {
        // update_state():  Override the base time-stepping code to say what this particular
        // scene should do to its bodies every frame -- including applying forces.
        // Generate additional moving bodies if there ever aren't enough:
        this.counter++;
        if (Math.floor(this.counter % 8) === 0) {
            this.bodies.push(new Body(this.random_shape(), this.materials.rock, vec3(1, 1 + Math.random(), 1), false)
                .emplace(Mat4.translation(...vec3(50, 25, 0).randomized(12)),
                    vec3(0, -1, 0).randomized(2).normalized().times(2), Math.random()));
        }
        const collider = this.colliders[this.collider_selection];

        for (let a of this.bodies) {
            // Cache the inverse of matrix of body "a" to save time.
            a.inverse = Mat4.inverse(a.drawn_location);

            //a.linear_velocity = a.linear_velocity.minus(a.center.times(dt));
            if (a.hit) {
                a.linear_velocity[0] *= 0.95;
                a.linear_velocity[1] += dt * -9.8;
                a.linear_velocity[2] *= 0.95;
                continue;
            }
            if (a.user_projectile) {
                a.linear_velocity[1] += dt * -4.9;
            } else {
                a.linear_velocity[0] += dt * -9.8;
            }

            /*if (a.linear_velocity[0] > 0)
                continue;*/
            // *** Collision process is here ***
            // Loop through all bodies again (call each "b"):

            // Pass the two bodies and the collision shape to check_if_colliding():
            if (a.check_if_colliding(this.opm, collider)) {
                a.hit = true;
                a.linear_velocity = a.linear_velocity.times(-0.45);
            }
            else if (a.check_if_colliding(this.pillars, collider)) {
                a.hit = true;
                a.linear_velocity = a.linear_velocity.times(-0.1);
            }
        }
        this.bodies = this.bodies.filter(b => b.center[0] > -50 && b.center[1] > -50);
    }

    display(context, program_state) {
        super.display(context, program_state);
        const gl = context.context;

        if (!context.scratchpad.controls) {
            this.children.push(context.scratchpad.controls = new defs.Movement_Controls());
            program_state.set_camera(Mat4.translation(0, -15, -40));

            let canvas = context.canvas;
            const mouse_position = (e, rect = canvas.getBoundingClientRect()) =>
                vec((e.clientX - (rect.left + rect.right) / 2) / ((rect.right - rect.left) / 2),
                    (e.clientY - (rect.bottom + rect.top) / 2) / ((rect.top - rect.bottom) / 2));

            canvas.addEventListener("mousedown", e => {
                e.preventDefault();
                const rect = canvas.getBoundingClientRect()
                console.log("e.clientX: " + e.clientX);
                console.log("e.clientX - rect.left: " + (e.clientX - rect.left));
                console.log("e.clientY: " + e.clientY);
                console.log("e.clientY - rect.top: " + (e.clientY - rect.top));
                console.log("mouse_position(e): " + mouse_position(e));
                let center_ndc_near = vec4(0.0, 0.0, -1.0, 1.0);
                let P = program_state.projection_transform;
                let V = program_state.camera_inverse;
                let center_world_near  = Mat4.inverse(P.times(V)).times(center_ndc_near);
                center_world_near.scale_by(1 / center_world_near[3]);
                let loc_matrix = Mat4.translation(center_world_near[0], center_world_near[1], center_world_near[2]);
                this.bodies.push(new Body(this.random_shape(), this.materials.rock, vec3(2, 2 + Math.random(), 2), true)
                    .emplace(loc_matrix,
                        vec3(mouse_position(e)[0], Math.max(0,mouse_position(e)[1]), -1).times(25), Math.random()));
            });
        }

        program_state.projection_transform = Mat4.perspective(
            Math.PI / 4, context.width / context.height, .1, 1000);

        const t = program_state.animation_time / 1000, dt = program_state.animation_delta_time / 1000;
        const ts = program_state.animation_time / 100;
        const tss = program_state.animation_time / 10;

        // The parameters of the Light are: position, color, size
        const light_position = vec4(this.x, this.y, this.z, 1);

        //const light_radius = 5;
        const sun_radius = 5;
        const light_size = 10**sun_radius;

        // Added the ability to change the sun's color into a randomized color
        let sun_color = color(this.r, this.g, this.b, 1);
        if (Math.floor(ts) % 2 === 0) {
            //sun_color = color(0.882, 0.666, 0.933,1);
            sun_color = color(this.r+0.1, this.g+0.1, this.b+0.1, 1);
        }

        //program_state.projection_transform = Mat4.perspective(Math.PI / 4, context.width / context.height, 1, 500);


        //Added the ability to
        program_state.lights = [new Light(light_position, sun_color, light_size)];

        let model_transform = Mat4.identity();
        this.opm.shape.draw(context, program_state, this.opm.drawn_location, this.materials.opm);

        // This section adds the background environment
        // The background consists of a cylinder and a floor
        // That is literally it.

        //This part adds a floor
        let model_transform_floor = model_transform.times(Mat4.scale(40, 1,30)).times(Mat4.translation(0,-38,0));
        this.shapes.platform.draw(context, program_state, model_transform_floor, this.materials.background_objects);


        //This part adds the cylinder background
        let model_transform_cylinder = model_transform.times(Mat4.translation(-21,10,-20)).times(Mat4.scale(10, 100, 10)).times(Mat4.rotation(55, 1,0,0));
        //this.shapes.pillar.draw(context, program_state, model_transform_cylinder, this.materials.background_objects);
        this.pillars.shape.draw(context, program_state, this.pillars.drawn_location, this.materials.background_objects);

        // set up camera
        if (this.attached) {
            if (this.attached() == this.initial_camera_location) {
                let desired = this.initial_camera_location;
                desired = desired.map((x, i) => Vector.from(program_state.camera_inverse[i]).mix(x, 0.1))
                program_state.set_camera(desired);
            } else {
                let desired = Mat4.inverse(this.attached().times(Mat4.translation(0, 0, 5)));
                desired = desired.map((x, i) => Vector.from(program_state.camera_inverse[i]).mix(x, 0.1))
                program_state.set_camera(desired);
            }
        }
    }
}

class Gouraud_Shader extends Shader {
    // This is a Shader using Phong_Shader as template
    // TODO: Modify the glsl coder here to create a Gouraud Shader (Planet 2)

    constructor(num_lights = 2) {
        super();
        this.num_lights = num_lights;
    }

    shared_glsl_code() {
        // ********* SHARED CODE, INCLUDED IN BOTH SHADERS *********
        return ` 
        precision mediump float;
        const int N_LIGHTS = ` + this.num_lights + `;
        uniform float ambient, diffusivity, specularity, smoothness;
        uniform vec4 light_positions_or_vectors[N_LIGHTS], light_colors[N_LIGHTS];
        uniform float light_attenuation_factors[N_LIGHTS];
        uniform vec4 shape_color;
        uniform vec3 squared_scale, camera_center;

        // Specifier "varying" means a variable's final value will be passed from the vertex shader
        // on to the next phase (fragment shader), then interpolated per-fragment, weighted by the
        // pixel fragment's proximity to each of the 3 vertices (barycentric interpolation).
        varying vec3 N, vertex_worldspace;
        
        // for gourand shader
        varying vec4 vertex_color;
        
        // ***** PHONG SHADING HAPPENS HERE: *****                                       
        vec3 phong_model_lights( vec3 N, vec3 vertex_worldspace ){                                        
            // phong_model_lights():  Add up the lights' contributions.
            vec3 E = normalize( camera_center - vertex_worldspace );
            vec3 result = vec3( 0.0 );
            for(int i = 0; i < N_LIGHTS; i++){
                // Lights store homogeneous coords - either a position or vector.  If w is 0, the 
                // light will appear directional (uniform direction from all points), and we 
                // simply obtain a vector towards the light by directly using the stored value.
                // Otherwise if w is 1 it will appear as a point light -- compute the vector to 
                // the point light's location from the current surface point.  In either case, 
                // fade (attenuate) the light as the vector needed to reach it gets longer.  
                vec3 surface_to_light_vector = light_positions_or_vectors[i].xyz - 
                                               light_positions_or_vectors[i].w * vertex_worldspace;                                             
                float distance_to_light = length( surface_to_light_vector );

                vec3 L = normalize( surface_to_light_vector );
                vec3 H = normalize( L + E );
                // Compute the diffuse and specular components from the Phong
                // Reflection Model, using Blinn's "halfway vector" method:
                float diffuse  =      max( dot( N, L ), 0.0 );
                float specular = pow( max( dot( N, H ), 0.0 ), smoothness );
                float attenuation = 1.0 / (1.0 + light_attenuation_factors[i] * distance_to_light * distance_to_light );
                
                vec3 light_contribution = shape_color.xyz * light_colors[i].xyz * diffusivity * diffuse
                                                          + light_colors[i].xyz * specularity * specular;
                result += attenuation * light_contribution;
            }
            return result;
        } `;
    }

    vertex_glsl_code() {
        // ********* VERTEX SHADER *********
        return this.shared_glsl_code() + `
            attribute vec3 position, normal;                            
            // Position is expressed in object coordinates.
            
            uniform mat4 model_transform;
            uniform mat4 projection_camera_model_transform;
    
            void main(){                                                                   
                // The vertex's final resting place (in NDCS):
                gl_Position = projection_camera_model_transform * vec4( position, 1.0 );
                // The final normal vector in screen space.
                N = normalize( mat3( model_transform ) * normal / squared_scale);
                vertex_worldspace = ( model_transform * vec4( position, 1.0 ) ).xyz;
                
                // for gouraud shader
                vertex_color = vec4( shape_color.xyz * ambient, shape_color.w );
                vertex_color.xyz = phong_model_lights( normalize( N ), vertex_worldspace );
            } `;
    }

    fragment_glsl_code() {
        // ********* FRAGMENT SHADER *********
        // A fragment is a pixel that's overlapped by the current triangle.
        // Fragments affect the final image or get discarded due to depth.
        return this.shared_glsl_code() + `
            void main(){                                                           
                // // Compute an initial (ambient) color:
                // gl_FragColor = vec4( shape_color.xyz * ambient, shape_color.w );
                // // Compute the final color with contributions from lights:
                // gl_FragColor.xyz += phong_model_lights( normalize( N ), vertex_worldspace );
                
                // for gouraud shader
                gl_FragColor = vertex_color;
            } `;
    }

    send_material(gl, gpu, material) {
        // send_material(): Send the desired shape-wide material qualities to the
        // graphics card, where they will tweak the Phong lighting formula.
        gl.uniform4fv(gpu.shape_color, material.color);
        gl.uniform1f(gpu.ambient, material.ambient);
        gl.uniform1f(gpu.diffusivity, material.diffusivity);
        gl.uniform1f(gpu.specularity, material.specularity);
        gl.uniform1f(gpu.smoothness, material.smoothness);
    }

    send_gpu_state(gl, gpu, gpu_state, model_transform) {
        // send_gpu_state():  Send the state of our whole drawing context to the GPU.
        const O = vec4(0, 0, 0, 1), camera_center = gpu_state.camera_transform.times(O).to3();
        gl.uniform3fv(gpu.camera_center, camera_center);
        // Use the squared scale trick from "Eric's blog" instead of inverse transpose matrix:
        const squared_scale = model_transform.reduce(
            (acc, r) => {
                return acc.plus(vec4(...r).times_pairwise(r))
            }, vec4(0, 0, 0, 0)).to3();
        gl.uniform3fv(gpu.squared_scale, squared_scale);
        // Send the current matrices to the shader.  Go ahead and pre-compute
        // the products we'll need of the of the three special matrices and just
        // cache and send those.  They will be the same throughout this draw
        // call, and thus across each instance of the vertex shader.
        // Transpose them since the GPU expects matrices as column-major arrays.
        const PCM = gpu_state.projection_transform.times(gpu_state.camera_inverse).times(model_transform);
        gl.uniformMatrix4fv(gpu.model_transform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
        gl.uniformMatrix4fv(gpu.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));

        // Omitting lights will show only the material color, scaled by the ambient term:
        if (!gpu_state.lights.length)
            return;

        const light_positions_flattened = [], light_colors_flattened = [];
        for (let i = 0; i < 4 * gpu_state.lights.length; i++) {
            light_positions_flattened.push(gpu_state.lights[Math.floor(i / 4)].position[i % 4]);
            light_colors_flattened.push(gpu_state.lights[Math.floor(i / 4)].color[i % 4]);
        }
        gl.uniform4fv(gpu.light_positions_or_vectors, light_positions_flattened);
        gl.uniform4fv(gpu.light_colors, light_colors_flattened);
        gl.uniform1fv(gpu.light_attenuation_factors, gpu_state.lights.map(l => l.attenuation));
    }

    update_GPU(context, gpu_addresses, gpu_state, model_transform, material) {
        // update_GPU(): Define how to synchronize our JavaScript's variables to the GPU's.  This is where the shader
        // recieves ALL of its inputs.  Every value the GPU wants is divided into two categories:  Values that belong
        // to individual objects being drawn (which we call "Material") and values belonging to the whole scene or
        // program (which we call the "Program_State").  Send both a material and a program state to the shaders
        // within this function, one data field at a time, to fully initialize the shader for a draw.

        // Fill in any missing fields in the Material object with custom defaults for this shader:
        const defaults = {color: color(0, 0, 0, 1), ambient: 0, diffusivity: 1, specularity: 1, smoothness: 40};
        material = Object.assign({}, defaults, material);

        this.send_material(context, gpu_addresses, material);
        this.send_gpu_state(context, gpu_addresses, gpu_state, model_transform);
    }
}

class Ring_Shader extends Shader {
    update_GPU(context, gpu_addresses, graphics_state, model_transform, material) {
        // update_GPU():  Defining how to synchronize our JavaScript's variables to the GPU's:
        const [P, C, M] = [graphics_state.projection_transform, graphics_state.camera_inverse, model_transform],
            PCM = P.times(C).times(M);
        context.uniformMatrix4fv(gpu_addresses.model_transform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
        context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false,
            Matrix.flatten_2D_to_1D(PCM.transposed()));
    }

    shared_glsl_code() {
        // ********* SHARED CODE, INCLUDED IN BOTH SHADERS *********
        return `
        precision mediump float;
        varying vec4 point_position;
        varying vec4 center;
        `;
    }

    vertex_glsl_code() {
        // ********* VERTEX SHADER *********
        // TODO:  Complete the main function of the vertex shader (Extra Credit Part II).
        return this.shared_glsl_code() + `
        attribute vec3 position;
        uniform mat4 model_transform;
        uniform mat4 projection_camera_model_transform;
        
        void main(){
            // The vertex's final resting place (in NDCS):
            gl_Position = projection_camera_model_transform * vec4( position, 1.0 );
            point_position = model_transform * vec4( position, 1.0 );
            
            // center of ring
            center = model_transform * vec4( 0.0, 0.0, 0.0, 1.0 );
        }`;
    }

    fragment_glsl_code() {
        // ********* FRAGMENT SHADER *********
        // TODO:  Complete the main function of the fragment shader (Extra Credit Part II).
        return this.shared_glsl_code() + `
        void main(){
            vec3 distance = vec3( point_position.xyz - center.xyz );
            
            gl_FragColor = vec4( vec3(0.816, 0.447, 0.318), cos( length(distance) * 20.0 ) );
        }`;
    }
}

