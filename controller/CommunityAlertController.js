import CommunityAlert from "../model/CommunityAlertSchema.js";
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';

const getAllPosts = async (req, res, next) => {
    try {
        const posts = await CommunityAlert.find().sort({ createdAt: -1 });

        const formattedPosts = posts.map(post => ({
            id: post._id.toString(),
            userId: post.userId,
            username: post.username,
            content: post.content,
            imageUrl: post.imageUrl,
            likes: post.likes,
            comments: post.comments.map(comment => ({
                id: comment._id?.toString() || '',
                userId: comment.userId,
                username: comment.username,
                content: comment.content,
                createdAt: comment.createdAt,
            })),
            createdAt: post.createdAt,
        }));

        successResponse(res, formattedPosts);
    } catch (error) {
        next(error);
    }
};

const createPost = async (req, res, next) => {
    try {
        const { content, imageUrl, userId, username } = req.body;

        if (!content || !userId || !username) {
            throw new AppError('Content, user ID, and username are required', 400);
        }

        const newPost = new CommunityAlert({
            userId,
            username,
            content,
            imageUrl
        });

        const savedPost = await newPost.save();

        const formattedPost = {
            id: savedPost._id.toString(),
            userId: savedPost.userId,
            username: savedPost.username,
            content: savedPost.content,
            imageUrl: savedPost.imageUrl,
            likes: savedPost.likes,
            comments: [],
            createdAt: savedPost.createdAt,
        };

        successResponse(res, formattedPost, 201);
    } catch (error) {
        next(error);
    }
};

const likePost = async (req, res, next) => {
    try {
        const post = await CommunityAlert.findById(req.params.postId);
        if (!post) {
            throw new AppError('Post not found', 404);
        }
        
        post.likes += 1;
        await post.save();
        
        successResponse(res, {
            id: post._id.toString(),
            likes: post.likes
        });
    } catch (error) {
        next(error);
    }
};

const commentOnPost = async (req, res, next) => {
    try {
        const { content, userId, username } = req.body;
        
        if (!content || !userId || !username) {
            throw new AppError('Content, user ID, and username are required', 400);
        }

        const post = await CommunityAlert.findById(req.params.postId);
        if (!post) {
            throw new AppError('Post not found', 404);
        }

        post.comments.push({ userId, username, content });
        await post.save();

        const newComment = post.comments[post.comments.length - 1];

        successResponse(res, {
            id: newComment._id?.toString() || '',
            userId: newComment.userId,
            username: newComment.username,
            content: newComment.content,
            createdAt: newComment.createdAt,
        }, 201);
    } catch (error) {
        next(error);
    }
};

export default { getAllPosts, createPost, likePost, commentOnPost };
