import Bull from "bull";
import dotenv from "dotenv";
import express from "express";

// Import bull-board components
import { createBullBoard } from "@bull-board/api";
import { BullAdapter } from "@bull-board/api/bullAdapter.js";
import { ExpressAdapter } from "@bull-board/express";

dotenv.config();

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const burgerQueue = new Bull("burger", REDIS_URL);

// ----------------------
// JOB EVENT LISTENERS
// ----------------------

burgerQueue.on('waiting', (jobId) => {
    console.log(`Job ${jobId} is waiting to be processed`);
});

burgerQueue.on('active', (job) => {
    console.log(`Job ${job.id} has started processing`);
});

burgerQueue.on('completed', (job, result) => {
    console.log(`Job ${job.id} has completed with result:`, result);
    console.log(`Sending notification: Burger #${job.data.orderNumber} is ready!`);
});

burgerQueue.on('failed', (job, error) => {
    console.error(`Job ${job.id} has failed with error:`, error);
    console.error(`Logging error to monitoring system: Burger #${job.data.orderNumber} failed.`);
});


burgerQueue.on('progress', (job, progress) => {
    console.log(`Job ${job.id} is ${progress}% complete`);
});


burgerQueue.on('stalled', (job) => {
    console.warn(`Job ${job.id} has stalled and will be reprocessed`);
});


burgerQueue.on('failed', (job, err) => {
    if (job.attemptsMade < job.opts.attempts) {
        console.log(`Job ${job.id} failed but will be retried. Attempt ${job.attemptsMade}/${job.opts.attempts}`);
    } else {
        console.error(`Job ${job.id} has failed permanently after ${job.opts.attempts} attempts`);
    }
});

// ----------------------
// JOB PROCESSING
// ----------------------

// Register process that takes 10 seconds to complete
burgerQueue.process(async (job, done) => {
    const startTime = new Date();
    console.log(`[${startTime.toISOString()}] Starting job #${job.id}: Preparing burger!`);
    console.log("Order details:", job.data);

    // Update progress periodically during the 10 seconds
    for (let i = 1; i <= 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        await job.progress(i * 10);
        console.log(`Job #${job.id} progress: ${i * 10}%`);
    }

    const endTime = new Date();
    const processingTime = (endTime - startTime) / 1000;

    console.log(`[${endTime.toISOString()}] Job #${job.id}: Burger ready! Processing time: ${processingTime} seconds`);


    if (Math.random() < 0.1) {
        return done(new Error("Burger burned! Need to remake."));
    }

    done(null, {
        completed: true,
        processingTime,
        completedAt: endTime
    });
});

// Fungsi untuk menambah burger job
const addBurgerJob = async (index) => {
    const toppings = [
        ["🥬", "🍅"],
        ["🥓", "🧅"],
        ["🥒", "🍄"],
        ["🥬", "🥓", "🍅"],
        ["🥚", "🧀"],
        ["🥬", "🥒", "🧅"],
        ["🥓", "🥚"],
        ["🍄", "🥬"],
        ["🥒", "🥓", "🥚"],
        ["🥬", "🍅", "🥓", "🥚"]
    ];

    const buns = ["🍞", "🥯", "🥐"];
    const cheeses = ["🧀", ""];

    // Create a unique burger for each job
    const burger = {
        bun: buns[index % buns.length],
        cheese: cheeses[index % cheeses.length],
        toppings: toppings[index % toppings.length],
        orderNumber: index + 1
    };

    const job = await burgerQueue.add(burger, {
        attempts: 2,     
        backoff: {
            type: 'fixed',
            delay: 5000    
        },
        removeOnComplete: false, 
        removeOnFail: false    
    });

    console.log(`Added job #${job.id} for burger #${index + 1}`);
    return job;
};

// Create 10 burger jobs on startup
const createInitialJobs = async () => {
    console.log("Creating 10 initial burger jobs...");

    for (let i = 0; i < 10; i++) {
        await addBurgerJob(i);
    }

    console.log("All 10 initial burger jobs have been added to the queue");
};

// Setup Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
    queues: [new BullAdapter(burgerQueue)],
    serverAdapter: serverAdapter,
});

// Use bull-board in Express app
app.use('/admin/queues', serverAdapter.getRouter());

// Root endpoint for API info
app.get('/', (req, res) => {
    res.json({
        message: "Burger Queue API",
        endpoints: {
            "GET /": "API info",
            "POST /burger": "Add new burger order",
            "GET /burger/:id": "Get burger order status",
            "POST /create-jobs": "Create 10 new burger jobs",
            "GET /jobs/status": "Get summary of all jobs",
            "POST /jobs/clean": "Clean completed and failed jobs",
            "GET /admin/queues": "Bull Board UI for queue management"
        }
    });
});

// Endpoint to add new burger to queue
app.post('/burger', async (req, res) => {
    try {
        const burgerData = req.body.burger || {
            bun: "🍞",
            cheese: "🧀",
            toppings: ["🥬", "🍅"]
        };

        // Add to queue with options
        const job = await burgerQueue.add(burgerData, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000
            }
        });

        res.status(201).json({
            message: "Burger order placed successfully",
            jobId: job.id,
            burger: burgerData,
            status: "processing",
            managementUI: `${req.protocol}://${req.get('host')}/admin/queues`
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to place burger order",
            details: error.message
        });
    }
});


app.post('/create-jobs', async (req, res) => {
    try {
        console.log("Creating 10 new burger jobs...");
        const jobs = [];

        for (let i = 0; i < 10; i++) {
            const job = await addBurgerJob(i);
            jobs.push({
                jobId: job.id,
                burger: job.data
            });
        }

        res.status(201).json({
            message: "Created 10 new burger jobs",
            jobs,
            managementUI: `${req.protocol}://${req.get('host')}/admin/queues`
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to create burger jobs",
            details: error.message
        });
    }
});


app.get('/burger/:id', async (req, res) => {
    try {
        const jobId = req.params.id;
        const job = await burgerQueue.getJob(jobId);

        if (!job) {
            return res.status(404).json({ error: "Burger order not found" });
        }

        const state = await job.getState();

        res.json({
            jobId: job.id,
            burger: job.data,
            status: state,
            progress: job._progress,
            result: job.returnvalue,
            attempts: job.attemptsMade,
            managementUI: `${req.protocol}://${req.get('host')}/admin/queues`
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to fetch burger status",
            details: error.message
        });
    }
});

// Endpoint untuk mendapatkan ringkasan status semua tugas
app.get('/jobs/status', async (req, res) => {
    try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            burgerQueue.getWaitingCount(),
            burgerQueue.getActiveCount(),
            burgerQueue.getCompletedCount(),
            burgerQueue.getFailedCount(),
            burgerQueue.getDelayedCount()
        ]);

        // Dapatkan senarai tugas aktif 
        const activeJobs = await burgerQueue.getActive();
        const activeDetails = activeJobs.map(job => ({
            id: job.id,
            progress: job._progress,
            orderNumber: job.data.orderNumber
        }));

        res.json({
            summary: {
                waiting,
                active,
                completed,
                failed,
                delayed,
                total: waiting + active + completed + failed + delayed
            },
            activeJobs: activeDetails,
            managementUI: `${req.protocol}://${req.get('host')}/admin/queues`
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to fetch jobs status",
            details: error.message
        });
    }
});

app.post('/jobs/clean', async (req, res) => {
    try {
        
        const keepJobs = req.body.keep || 10; // Simpan 10 tugas terbaru secara lalai

        await burgerQueue.clean(0, 'completed', keepJobs);
        await burgerQueue.clean(0, 'failed', keepJobs);

        res.json({
            message: `Cleaned completed and failed jobs (kept ${keepJobs} most recent)`,
            managementUI: `${req.protocol}://${req.get('host')}/admin/queues`
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to clean jobs",
            details: error.message
        });
    }
});


app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Connected to Redis at: ${REDIS_URL}`);
    console.log(`Bull Board UI available at: http://localhost:${PORT}/admin/queues`);
    console.log("Ready to prepare burgers! 🍔");
    await createInitialJobs();
});